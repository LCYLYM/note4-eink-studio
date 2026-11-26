#include "voice_agent.hpp"
#include "peripherals.hpp"
#include "led_cue.hpp"
#include "network.hpp"
#include "js_app.h"
#include "cJSON.h"
#include "nvs.h"
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_pm.h"
#include "esp_random.h"
#include "esp_timer.h"
#include <atomic>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <mutex>
#include <vector>
#include <sys/stat.h>
#include <unistd.h>

namespace note4 {
namespace {

constexpr size_t kMpHeadMax = 160;
constexpr size_t kMpTailMax = 48;
constexpr size_t kWavHdrBytes = 44;
constexpr size_t kSlotMaxSamples = 16000 * 30;               // 30s @ 16kHz mono
constexpr size_t kSlotBytes = kMpHeadMax + kWavHdrBytes + kSlotMaxSamples * 2 + kMpTailMax;
constexpr size_t kSplitMinSamples = 16000 * 20;              // 20s -> watch for silence valley
constexpr size_t kSplitHardSamples = 16000 * 28;             // 28s -> mandatory split
constexpr int kMaxSpoolFiles = 4;
constexpr int kMaxAgentSteps = 3;
constexpr int kMaxToolsPerStep = 4;
constexpr int kMaxTotalToolsPerTurn = 4; // Hard per-trigger tool execution cap to prevent runaway loops!
constexpr int kMaxCallsPerMinute = 12;
constexpr int kMaxCallsPerBoot = 150;
constexpr int kMaxLongSessionChunks = 130; // ~60 min continuous meeting ceiling; silent chunks never stop mic!

struct AiCred {
    std::string kind = "dsh_token"; // "dsh_token" | "api_key"
    std::string token;
    std::string base_url = "https://api.deepseek.com";
    std::string model = "deepseek-flash";
    int64_t rev = 0;
};

struct HistTurn {
    std::string user;
    std::string assistant;
};

struct PingPongSlot {
    uint8_t* buf = nullptr;          // 44B WAV header + 16-bit LE PCM
    std::atomic<size_t> samples{0};
    std::atomic<uint32_t> voiced{0}; // 5ms blocks with RMS >= 260
    std::atomic<int> state{0};       // 0=FREE, 1=WRITING, 2=SEALED
    uint32_t seq = 0;
};

SemaphoreHandle_t g_js_lock = nullptr;
std::mutex g_cred_mu;
AiCred g_cred;

std::string g_app_id;
uint8_t g_vmode = 0;     // 0=off, 1=ptt, 2=long, 3=both
uint8_t g_vtts = 1;      // 0=off, 1=stella, 2=tide
bool g_vsearch = true;
bool g_vthinking = false;

PingPongSlot g_slots[2];
std::atomic<int> g_write_idx{0};
std::atomic<uint32_t> g_chunk_seq{0};
std::atomic<uint16_t> g_silence_blocks{0};
std::atomic<uint32_t> g_dropped_samples{0};
std::atomic<int> g_session_chunks{0};
std::atomic<int> g_silent_chunks{0};
std::atomic<size_t> g_fast_split_samples{0};
std::mutex g_budget_mu;
int64_t g_win_start_us = 0;
int g_win_calls = 0;
std::atomic<uint32_t> g_boot_api_calls{0};

std::atomic<bool> g_recording{false};
std::atomic<bool> g_long_mode{false};
std::atomic<bool> g_was_long_session{false};
std::atomic<bool> g_finalize_rec{false};
std::atomic<bool> g_voice_abort{false};
std::atomic<uint32_t> g_turn_gen{1};
std::atomic<int> g_phase{0}; // 0=idle, 1=listening, 2=thinking, 3=speaking, 4=error
esp_pm_lock_handle_t g_pm_boost = nullptr;
bool g_pm_held = false;

inline void set_cpu_boost(bool want) {
    if (!g_pm_boost || want == g_pm_held) return;
    if (want) esp_pm_lock_acquire(g_pm_boost);
    else esp_pm_lock_release(g_pm_boost);
    g_pm_held = want;
}
inline bool is_aborted(uint32_t gen) {
    return g_voice_abort.load(std::memory_order_acquire) || g_turn_gen.load(std::memory_order_acquire) != gen;
}

bool acquire_api_budget(const char* endpoint_tag) {
    std::lock_guard<std::mutex> lk(g_budget_mu);
    const int64_t now = esp_timer_get_time();
    if (now - g_win_start_us >= 60000000LL) {
        g_win_start_us = now;
        g_win_calls = 0;
    }
    if (g_win_calls >= kMaxCallsPerMinute || g_boot_api_calls.load() >= kMaxCallsPerBoot) {
        printf("NOTE4 VOICE {\"budget_guard_tripped\":\"%s\",\"win_calls\":%d,\"boot_calls\":%lu}\n",
               endpoint_tag, g_win_calls, (unsigned long)g_boot_api_calls.load());
        g_voice_abort.store(true, std::memory_order_release);
        return false;
    }
    ++g_win_calls;
    g_boot_api_calls.fetch_add(1, std::memory_order_relaxed);
    return true;
}

std::mutex g_sim_mu;
std::string g_sim_text;
bool g_sim_pending = false;
std::atomic<bool> g_mock_enabled{false};
std::string g_mock_chunk_text = "新增待办：下午三点复盘墨水屏语音固件";

HistTurn g_hist[3];
int g_hist_count = 0;

void write_wav_header(uint8_t* h, uint32_t pcm_bytes) {
    auto u32 = [](uint8_t* p, uint32_t v) { p[0]=v&0xff; p[1]=(v>>8)&0xff; p[2]=(v>>16)&0xff; p[3]=(v>>24)&0xff; };
    auto u16 = [](uint8_t* p, uint16_t v) { p[0]=v&0xff; p[1]=(v>>8)&0xff; };
    std::memcpy(h, "RIFF", 4); u32(h + 4, 36 + pcm_bytes);
    std::memcpy(h + 8, "WAVEfmt ", 8); u32(h + 16, 16);
    u16(h + 20, 1); u16(h + 22, 1); u32(h + 24, 16000); u32(h + 28, 32000);
    u16(h + 32, 2); u16(h + 34, 16);
    std::memcpy(h + 36, "data", 4); u32(h + 40, pcm_bytes);
}

bool ensure_slots_allocated() {
    for (int i = 0; i < 2; ++i) {
        if (!g_slots[i].buf) g_slots[i].buf = static_cast<uint8_t*>(heap_caps_malloc(kSlotBytes, MALLOC_CAP_SPIRAM));
        if (!g_slots[i].buf) return false;
    }
    return true;
}

void seal_current_slot_from_mic(int cur_idx) {
    g_slots[cur_idx].state.store(2, std::memory_order_release); // SEALED
    const int next_idx = 1 - cur_idx;
    if (g_slots[next_idx].state.load(std::memory_order_acquire) == 0) {
        g_slots[next_idx].samples.store(0, std::memory_order_relaxed);
        g_slots[next_idx].voiced.store(0, std::memory_order_relaxed);
        g_slots[next_idx].seq = ++g_chunk_seq;
        g_slots[next_idx].state.store(1, std::memory_order_release);
        g_write_idx.store(next_idx, std::memory_order_release);
    }
    g_silence_blocks.store(0, std::memory_order_relaxed);
}

void mic_pcm_callback(const int16_t* pcm16k, size_t count) {
    if (!g_recording.load(std::memory_order_acquire) || g_voice_abort.load(std::memory_order_relaxed)) return;
    int idx = g_write_idx.load(std::memory_order_acquire);
    if (g_slots[idx].state.load(std::memory_order_acquire) != 1) {
        const int alt = 1 - idx;
        if (g_slots[alt].state.load(std::memory_order_acquire) == 0) {
            g_slots[alt].samples.store(0, std::memory_order_relaxed);
            g_slots[alt].voiced.store(0, std::memory_order_relaxed);
            g_slots[alt].seq = ++g_chunk_seq;
            g_slots[alt].state.store(1, std::memory_order_release);
            g_write_idx.store(alt, std::memory_order_release);
            idx = alt;
        } else {
            g_dropped_samples.fetch_add(uint32_t(count), std::memory_order_relaxed);
            return;
        }
    }
    size_t cur = g_slots[idx].samples.load(std::memory_order_relaxed);
    const size_t room = cur < kSlotMaxSamples ? (kSlotMaxSamples - cur) : 0;
    const size_t n = std::min(count, room);
    if (n > 0) {
        std::memcpy(g_slots[idx].buf + kMpHeadMax + kWavHdrBytes + cur * 2, pcm16k, n * 2);
        cur += n;
        g_slots[idx].samples.store(cur, std::memory_order_release);
    }
    // Silence-valley detector after 20s (>180ms = 36 blocks of 5ms low RMS), or hard split at 28s
    int64_t sum_sq = 0;
    for (size_t i = 0; i < count; ++i) sum_sq += int64_t(pcm16k[i]) * int64_t(pcm16k[i]);
    const int rms = count ? int(std::sqrt(double(sum_sq) / double(count))) : 0;
    if (rms >= 620) g_slots[idx].voiced.fetch_add(1, std::memory_order_relaxed);
    uint16_t sil = rms < 420 ? uint16_t(g_silence_blocks.load(std::memory_order_relaxed) + 1) : 0;
    g_silence_blocks.store(sil, std::memory_order_relaxed);

    const size_t custom_split = g_fast_split_samples.load(std::memory_order_relaxed);
    if ((custom_split > 0 && cur >= custom_split) || (cur >= kSplitMinSamples && sil >= 36) || cur >= kSplitHardSamples) {
        seal_current_slot_from_mic(idx);
    }
}

std::string read_nvs_str(nvs_handle_t h, const char* k, const char* def_val = "") {
    size_t n = 0;
    if (nvs_get_str(h, k, nullptr, &n) != ESP_OK || n == 0 || n > 2200) return def_val;
    std::string s(n, '\0');
    if (nvs_get_str(h, k, s.data(), &n) != ESP_OK) return def_val;
    if (!s.empty() && s.back() == '\0') s.pop_back();
    return s;
}

void load_cred_from_nvs() {
    std::lock_guard<std::mutex> lk(g_cred_mu);
    nvs_handle_t h;
    if (nvs_open("n4_ai", NVS_READONLY, &h) != ESP_OK) return;
    g_cred.kind = read_nvs_str(h, "kind", "dsh_token");
    g_cred.token = read_nvs_str(h, "token", "");
    g_cred.base_url = read_nvs_str(h, "base_url", "https://api.deepseek.com");
    g_cred.model = read_nvs_str(h, "model", "deepseek-flash");
    int64_t r = 0;
    if (nvs_get_i64(h, "rev", &r) == ESP_OK) g_cred.rev = r;
    nvs_close(h);
}

AiCred snapshot_cred() {
    std::lock_guard<std::mutex> lk(g_cred_mu);
    return g_cred;
}

std::string build_v1_url(const AiCred& c, const char* v1_subpath) {
    std::string b = c.base_url.empty() ? "https://api.deepseek.com" : c.base_url;
    while (!b.empty() && b.back() == '/') b.pop_back();
    if (b.size() >= 3 && b.compare(b.size() - 3, 3, "/v1") == 0) return b + v1_subpath;
    return b + "/v1" + v1_subpath;
}

void apply_ai_auth(esp_http_client_handle_t h, const AiCred& c) {
    if (c.kind == "dsh_token") {
        esp_http_client_set_header(h, "x-dsh-auth-token", c.token.c_str());
    } else {
        std::string bearer = "Bearer " + c.token;
        esp_http_client_set_header(h, "Authorization", bearer.c_str());
    }
    esp_http_client_set_header(h, "User-Agent", "NOTE4-VoiceAgent/2.0.0");
}

struct KaStreamCtx {
    std::string* out_str = nullptr;
    bool stream_tts = false;
    bool tts_started = false;
    size_t tts_prebuf = 14400;
    uint32_t gen = 0;
    uint8_t carry = 0;
    bool has_carry = false;
    int64_t t0_us = 0;
    int ttfb_ms = -1;
    size_t pcm_bytes = 0;
};

esp_http_client_handle_t g_ka_http = nullptr;
std::string g_ka_origin;
int64_t g_ka_last_ok_us = 0;
std::atomic<bool> g_ka_dirty{false};

void ka_reset() {
    if (g_ka_http) {
        esp_http_client_cleanup(g_ka_http);
        g_ka_http = nullptr;
    }
    g_ka_origin.clear();
    g_ka_last_ok_us = 0;
}

void wait_tls_clock_ready() {
    for (int i = 0; i < 35 && std::time(nullptr) < 1700000000 && !g_voice_abort.load(std::memory_order_relaxed); ++i) {
        vTaskDelay(pdMS_TO_TICKS(40));
    }
}

esp_err_t ka_http_event(esp_http_client_event_t* e) {
    auto* sc = static_cast<KaStreamCtx*>(e->user_data);
    if (!sc || is_aborted(sc->gen)) return ESP_FAIL;
    if (e->event_id != HTTP_EVENT_ON_DATA || e->data_len <= 0) return ESP_OK;
    if (sc->ttfb_ms < 0 && sc->t0_us > 0) sc->ttfb_ms = int((esp_timer_get_time() - sc->t0_us) / 1000);
    if (sc->stream_tts) {
        int code = esp_http_client_get_status_code(e->client);
        if (code != 200) return ESP_OK;
        if (!sc->tts_started) {
            if (!audio_tts_begin(sc->tts_prebuf)) return ESP_FAIL;
            sc->tts_started = true;
        }
        const auto* src = static_cast<const uint8_t*>(e->data);
        int rem = e->data_len, pos = 0;
        uint8_t aligned[2050];
        while (rem > 0 && !is_aborted(sc->gen)) {
            int take = std::min<int>(rem, 2048);
            int n = 0;
            if (sc->has_carry) { aligned[n++] = sc->carry; sc->has_carry = false; }
            std::memcpy(aligned + n, src + pos, size_t(take));
            n += take; pos += take; rem -= take;
            if (n & 1) { sc->carry = aligned[n - 1]; sc->has_carry = true; --n; }
            if (n > 0) {
                audio_tts_push(reinterpret_cast<const int16_t*>(aligned), size_t(n / 2), 2500);
                sc->pcm_bytes += size_t(n);
            }
        }
        return is_aborted(sc->gen) ? ESP_FAIL : ESP_OK;
    }
    if (sc->out_str && sc->out_str->size() + size_t(e->data_len) <= 32768) {
        sc->out_str->append(static_cast<const char*>(e->data), size_t(e->data_len));
    }
    return ESP_OK;
}

int ka_perform(const std::string& url, const AiCred& c, esp_http_client_method_t method,
               const char* content_type, const char* body, size_t body_len, int timeout_ms, KaStreamCtx& sc) {
    if (!sc.gen) sc.gen = g_turn_gen.load(std::memory_order_acquire);
    wait_tls_clock_ready();
    const auto slash = url.find('/', 8);
    const std::string origin = slash == std::string::npos ? url : url.substr(0, slash);
    if (g_ka_dirty.exchange(false, std::memory_order_acq_rel) || (g_ka_http && g_ka_origin != origin)) ka_reset();

    for (int attempt = 0; attempt < 2 && !is_aborted(sc.gen); ++attempt) {
        const bool was_warm = (g_ka_http != nullptr);
        if (!g_ka_http) {
            esp_http_client_config_t cfg{};
            cfg.url = url.c_str();
            cfg.crt_bundle_attach = esp_crt_bundle_attach;
            cfg.event_handler = ka_http_event;
            cfg.user_data = &sc;
            cfg.keep_alive_enable = true;
            cfg.keep_alive_idle = 30;
            cfg.keep_alive_interval = 5;
            cfg.keep_alive_count = 3;
            cfg.timeout_ms = timeout_ms;
            cfg.buffer_size = 8192;
            cfg.buffer_size_tx = 4096;
            g_ka_http = esp_http_client_init(&cfg);
            if (!g_ka_http) return 0;
            g_ka_origin = origin;
        }
        if (sc.out_str) sc.out_str->clear();
        sc.t0_us = esp_timer_get_time();
        sc.ttfb_ms = -1;
        esp_http_client_set_url(g_ka_http, url.c_str());
        esp_http_client_set_user_data(g_ka_http, &sc);
        esp_http_client_set_method(g_ka_http, method);
        esp_http_client_set_timeout_ms(g_ka_http, timeout_ms);
        esp_http_client_delete_header(g_ka_http, "x-dsh-auth-token");
        esp_http_client_delete_header(g_ka_http, "Authorization");
        apply_ai_auth(g_ka_http, c);
        if (content_type && content_type[0]) esp_http_client_set_header(g_ka_http, "Content-Type", content_type);
        else esp_http_client_delete_header(g_ka_http, "Content-Type");
        esp_http_client_set_post_field(g_ka_http, body_len ? body : nullptr, int(body_len));

        esp_err_t err = esp_http_client_perform(g_ka_http);
        if (err == ESP_OK) {
            g_ka_last_ok_us = esp_timer_get_time();
            return esp_http_client_get_status_code(g_ka_http);
        }
        ka_reset();
        if (!was_warm || sc.tts_started) break; // Retry once only if an idle warm socket closed before response
    }
    return g_voice_abort.load(std::memory_order_acquire) ? -1 : 0;
}

void prewarm_tls_if_needed() {
    if (g_mock_enabled.load(std::memory_order_relaxed) || g_voice_abort.load(std::memory_order_relaxed)) return;
    const int64_t now = esp_timer_get_time();
    if (g_ka_http && now - g_ka_last_ok_us < 25000000LL) return;
    const AiCred c = snapshot_cred();
    if (c.token.empty() || !network_connected()) return;
    std::string dummy;
    KaStreamCtx sc{}; sc.out_str = &dummy;
    const int64_t t0 = esp_timer_get_time();
    int st = ka_perform(build_v1_url(c, "/models"), c, HTTP_METHOD_GET, nullptr, nullptr, 0, 8000, sc);
    printf("NOTE4 VOICE {\"tls_prewarm\":%d,\"ms\":%d}\n", st, int((esp_timer_get_time() - t0) / 1000));
}

int post_json_abortable(const std::string& url, const AiCred& c, const std::string& body, std::string& out, int timeout_ms) {
    out.clear();
    if (g_voice_abort.load(std::memory_order_acquire) || !acquire_api_budget("json_post")) return -1;
    KaStreamCtx sc{}; sc.out_str = &out;
    const int64_t t0 = esp_timer_get_time();
    int status = ka_perform(url, c, HTTP_METHOD_POST, "application/json", body.data(), body.size(), timeout_ms, sc);
    printf("NOTE4 VOICE {\"http_post\":%d,\"ms\":%d,\"ttfb_ms\":%d}\n", status, int((esp_timer_get_time() - t0) / 1000), sc.ttfb_ms);
    return status;
}

bool upload_asr_slot_buf(uint8_t* slot_buf, size_t wav_len, std::string& text_out, int* out_code = nullptr) {
    text_out.clear();
    if (out_code) *out_code = 200;
    if (wav_len <= kWavHdrBytes + 1600) return true; // <50ms tap = empty silence
    if (g_mock_enabled.load(std::memory_order_acquire)) {
        vTaskDelay(pdMS_TO_TICKS(40));
        std::lock_guard<std::mutex> lk(g_sim_mu);
        text_out = g_mock_chunk_text;
        return true;
    }
    const AiCred c = snapshot_cred();
    if (c.token.empty() || (!network_connected() && !wifi_up(12000))) { if (out_code) *out_code = 0; return false; }
    if (!acquire_api_budget("asr")) { if (out_code) *out_code = 429; return false; }

    static const char kBoundary[] = "----N4VoiceBoundary7e9a";
    static const char kHead[] = "------N4VoiceBoundary7e9a\r\nContent-Disposition: form-data; name=\"file\"; filename=\"chunk.wav\"\r\nContent-Type: audio/wav\r\n\r\n";
    static const char kTail[] = "\r\n------N4VoiceBoundary7e9a--\r\n";
    constexpr size_t kHeadLen = sizeof(kHead) - 1;
    constexpr size_t kTailLen = sizeof(kTail) - 1;
    static_assert(kHeadLen <= kMpHeadMax && kTailLen <= kMpTailMax, "Multipart framing fits slot margins");

    uint8_t* mp_start = slot_buf + (kMpHeadMax - kHeadLen);
    std::memcpy(mp_start, kHead, kHeadLen);
    std::memcpy(slot_buf + kMpHeadMax + wav_len, kTail, kTailLen);
    const size_t total_len = kHeadLen + wav_len + kTailLen;

    std::string resp;
    KaStreamCtx sc{}; sc.out_str = &resp;
    const std::string ctype = std::string("multipart/form-data; boundary=") + kBoundary;
    const int64_t t0 = esp_timer_get_time();
    int code = ka_perform(build_v1_url(c, "/tools/asr"), c, HTTP_METHOD_POST, ctype.c_str(),
                          reinterpret_cast<const char*>(mp_start), total_len, 25000, sc);
    if (out_code) *out_code = code;
    printf("NOTE4 VOICE {\"asr_http\":%d,\"wav_bytes\":%u,\"ms\":%d}\n", code, unsigned(wav_len), int((esp_timer_get_time() - t0) / 1000));
    if (code != 200 || g_voice_abort.load()) return false;
    if (auto* j = cJSON_Parse(resp.c_str())) {
        if (auto* t = cJSON_GetObjectItem(j, "text"); cJSON_IsString(t)) text_out = t->valuestring;
        cJSON_Delete(j);
    }
    return true;
}

void append_transcript_doc(const std::string& seg) {
    if (seg.empty()) return;
    FILE* f = std::fopen("/data/voice_tx.txt", "ab");
    if (!f) return;
    std::fwrite(seg.data(), 1, seg.size(), f);
    std::fwrite("\n", 1, 1, f);
    std::fclose(f);
}

void spool_slot_to_disk(const uint8_t* wav_bytes, size_t wav_len) {
    for (int i = 0; i < kMaxSpoolFiles; ++i) {
        char path[32]; std::snprintf(path, sizeof path, "/data/spool_%d.wav", i);
        struct stat st{};
        if (stat(path, &st) != 0) {
            FILE* f = std::fopen(path, "wb");
            if (f) { std::fwrite(wav_bytes, 1, wav_len, f); std::fclose(f); }
            printf("NOTE4 VOICE {\"spooled\":\"%s\",\"bytes\":%u}\n", path, unsigned(wav_len));
            return;
        }
    }
}

bool is_transient_asr_err(int code) {
    return code == 0 || code == 408 || code == 502 || code == 503 || code == 504;
}

void drain_spooled_wavs(uint8_t* scratch_slot) {
    if (!scratch_slot) return;
    for (int i = 0; i < kMaxSpoolFiles && !g_voice_abort.load(); ++i) {
        char path[32]; std::snprintf(path, sizeof path, "/data/spool_%d.wav", i);
        struct stat st{};
        const size_t max_wav = kWavHdrBytes + kSlotMaxSamples * 2;
        if (stat(path, &st) != 0) continue;
        if (st.st_size <= int(kWavHdrBytes) || size_t(st.st_size) > max_wav) { std::remove(path); continue; }
        FILE* f = std::fopen(path, "rb");
        if (!f) continue;
        size_t got = std::fread(scratch_slot + kMpHeadMax, 1, size_t(st.st_size), f);
        std::fclose(f);
        std::string txt;
        int code = 0;
        if (got == size_t(st.st_size) && upload_asr_slot_buf(scratch_slot, got, txt, &code)) {
            append_transcript_doc(txt);
            std::remove(path); // Immediately unlink after 200 OK ("不断传、不断删")!
            printf("NOTE4 VOICE {\"spool_drained\":\"%s\"}\n", path);
        } else if (is_transient_asr_err(code)) {
            break; // Network still offline; keep for next window
        } else {
            std::remove(path); // Drop unrecoverable/silent (e.g. 550/4xx) spool file so it never loops
            printf("NOTE4 VOICE {\"spool_dropped\":\"%s\",\"http\":%d}\n", path, code);
            if (code == 401 || code == 403) { g_voice_abort.store(true); break; }
        }
    }
}

uint64_t fnv1a64(const std::string& a, const std::string& b) {
    uint64_t h = 14695981039346656037ULL;
    for (unsigned char c : a) { h ^= c; h *= 1099511628211ULL; }
    h ^= 0xffu; h *= 1099511628211ULL;
    for (unsigned char c : b) { h ^= c; h *= 1099511628211ULL; }
    return h;
}

std::string sanitize_spoken_text(const std::string& raw) {
    std::string out;
    out.reserve(std::min<size_t>(raw.size(), 360));
    for (size_t i = 0; i < raw.size() && out.size() < 360; ++i) {
        char ch = raw[i];
        if (ch == '*' || ch == '#' || ch == '`' || ch == '~') continue;
        if (ch == '\r' || ch == '\n') ch = ' ';
        out.push_back(ch);
    }
    while (!out.empty() && out.size() > 350 && (static_cast<unsigned char>(out.back()) & 0xC0) == 0x80) out.pop_back();
    if (out.size() > 350 && (static_cast<unsigned char>(out.back()) & 0x80)) out.pop_back();
    return out;
}

void play_mock_tts_cadence(size_t text_bytes) {
    if (!audio_tts_begin()) return;
    const size_t dur_samples = std::clamp<size_t>(text_bytes * 220, 4800, 24000); // 0.2s..1.0s @ 24kHz
    int16_t chunk[240];
    float ph = 0;
    const float freqs[3] = {523.25f, 659.25f, 783.99f};
    for (size_t pos = 0; pos < dur_samples && !g_voice_abort.load(); pos += 240) {
        const size_t n = std::min<size_t>(240, dur_samples - pos);
        const float hz = freqs[(pos / 3200) % 3];
        for (size_t i = 0; i < n; ++i) {
            const float env = ((pos + i) % 3200 < 2600) ? 0.22f : 0.03f;
            ph += 6.2831853f * hz / 24000.0f;
            if (ph >= 6.2831853f) ph -= 6.2831853f;
            chunk[i] = int16_t(std::sin(ph) * 14000.0f * env);
        }
        audio_tts_push(chunk, n, 500);
    }
    audio_tts_finish();
    while (audio_tts_playing() && !g_voice_abort.load()) vTaskDelay(pdMS_TO_TICKS(15));
}

void stream_tts_reply(const std::string& raw_text) {
    const std::string clean = sanitize_spoken_text(raw_text);
    if (clean.empty() || g_vtts == 0) {
        audio_play_cue(CUE_DONE);
        return;
    }
    g_phase.store(3, std::memory_order_release);
    led_set_mode(LedMode::SPEAKING_PULSE);
    if (g_js_lock && xSemaphoreTake(g_js_lock, pdMS_TO_TICKS(200)) == pdTRUE) {
        js_agent_emit("speaking", clean.c_str());
        xSemaphoreGive(g_js_lock);
    }
    if (g_mock_enabled.load(std::memory_order_acquire)) {
        play_mock_tts_cadence(clean.size());
        return;
    }
    const AiCred c = snapshot_cred();
    if (c.token.empty() || (!network_connected() && !wifi_up(12000)) || !acquire_api_budget("tts")) {
        audio_play_cue(CUE_DONE);
        return;
    }
    cJSON* req = cJSON_CreateObject();
    cJSON_AddStringToObject(req, "text", clean.c_str());
    cJSON_AddStringToObject(req, "voice_id", g_vtts == 2 ? "tide" : "stella");
    cJSON_AddStringToObject(req, "format", "pcm");
    cJSON_AddBoolToObject(req, "filter_markdown", true);
    char* jstr = cJSON_PrintUnformatted(req);
    std::string body = jstr ? jstr : "{}";
    cJSON_free(jstr); cJSON_Delete(req);

    const uint32_t my_gen = g_turn_gen.load(std::memory_order_acquire);
    const std::string url = build_v1_url(c, "/tools/tts");
    KaStreamCtx sc{};
    sc.stream_tts = true;
    sc.gen = my_gen;
    // Adaptive 0.60s prebuffer for short crisp replies (<=22 CJK chars), 0.90s for longer replies -> 0 underruns
    sc.tts_prebuf = clean.size() <= 66 ? 14400u : 21600u;
    const int64_t t0 = esp_timer_get_time();
    int code = ka_perform(url, c, HTTP_METHOD_POST, "application/json", body.data(), body.size(), 20000, sc);
    const int dl_ms = int((esp_timer_get_time() - t0) / 1000);
    if (sc.tts_started) {
        if (!is_aborted(my_gen)) {
            audio_tts_finish();
            while (audio_tts_playing() && !is_aborted(my_gen)) vTaskDelay(pdMS_TO_TICKS(12));
        } else {
            audio_tts_abort();
        }
        printf("NOTE4 VOICE {\"tts_http\":%d,\"pcm_bytes\":%u,\"ttfb_ms\":%d,\"dl_ms\":%d,\"play_ms\":%d,\"underruns\":%lu}\n",
               code, unsigned(sc.pcm_bytes), sc.ttfb_ms, dl_ms, int((esp_timer_get_time() - t0) / 1000), (unsigned long)audio_tts_underruns());
    } else {
        printf("NOTE4 VOICE {\"tts_http\":%d,\"dl_ms\":%d}\n", code, dl_ms);
        if (!is_aborted(my_gen)) audio_play_cue(CUE_DONE);
    }
}

std::string exec_builtin_web_tool(const AiCred& c, const std::string& name, const std::string& args_json, const std::string& ori_q) {
    cJSON* a = cJSON_Parse(args_json.c_str());
    std::string result = "{\"results\":[]}";
    if (name == "web_search") {
        const char* q = a && cJSON_IsString(cJSON_GetObjectItem(a, "query")) ? cJSON_GetObjectItem(a, "query")->valuestring : "";
        if (g_mock_enabled.load()) {
            result = std::string("{\"results\":[{\"title\":\"模拟搜索:") + q + "\",\"summary\":\"今日晴，22度，空气优，出行畅通\"}]}";
        } else {
            cJSON* req = cJSON_CreateObject();
            cJSON_AddStringToObject(req, "query", q);
            cJSON_AddNumberToObject(req, "count", 4);
            cJSON_AddBoolToObject(req, "need_content", false);
            cJSON_AddStringToObject(req, "ori_question", ori_q.substr(0, 200).c_str());
            char* p = cJSON_PrintUnformatted(req); std::string b = p ? p : "{}"; cJSON_free(p); cJSON_Delete(req);
            std::string resp;
            int st = post_json_abortable(build_v1_url(c, "/tools/search"), c, b, resp, 15000);
            if (st == 200 && !resp.empty()) {
                if (resp.size() > 2040) resp.resize(2040);
                result = resp;
            } else {
                result = "{\"error\":\"search_unavailable_http_" + std::to_string(st) + "\"}";
            }
        }
    } else if (name == "read_url") {
        const char* u = a && cJSON_IsString(cJSON_GetObjectItem(a, "url")) ? cJSON_GetObjectItem(a, "url")->valuestring : "";
        cJSON* req = cJSON_CreateObject();
        cJSON_AddStringToObject(req, "url", u);
        char* p = cJSON_PrintUnformatted(req); std::string b = p ? p : "{}"; cJSON_free(p); cJSON_Delete(req);
        std::string resp;
        int st = post_json_abortable(build_v1_url(c, "/tools/fetch"), c, b, resp, 15000);
        if (st == 200 && !resp.empty()) {
            if (resp.size() > 2040) resp.resize(2040);
            result = resp;
        } else {
            result = "{\"error\":\"fetch_unavailable_http_" + std::to_string(st) + "\"}";
        }
    }
    if (a) cJSON_Delete(a);
    return result;
}

bool run_dsh_micro_agent(const std::string& utterance) {
    if (utterance.empty() || g_voice_abort.load()) return false;
    std::string role, tools_raw, state_json = "{}";
    bool has_ag = false;
    if (g_js_lock && xSemaphoreTake(g_js_lock, pdMS_TO_TICKS(3500)) == pdTRUE) {
        has_ag = js_agent_configured();
        if (has_ag) {
            role = js_agent_role();
            tools_raw = js_agent_tools_json();
            char sbuf[2048];
            if (js_agent_read_state(sbuf, sizeof(sbuf))) state_json = sbuf;
            js_agent_emit("thinking", "思考中…");
        }
        xSemaphoreGive(g_js_lock);
    }
    if (!has_ag) {
        printf("NOTE4 VOICE {\"error\":\"no_agent_config\"}\n");
        return false;
    }

    const AiCred c = snapshot_cred();
    if (c.token.empty() || (!network_connected() && !wifi_up(15000))) {
        if (g_js_lock && xSemaphoreTake(g_js_lock, pdMS_TO_TICKS(500)) == pdTRUE) {
            js_agent_emit("error", c.token.empty() ? "请先绑定DeepSeek账号或Key" : "WiFi未连接");
            xSemaphoreGive(g_js_lock);
        }
        return false;
    }

    // 1. Static system prompt for 90%+ DeepSeek KV prefix cache hit + warm human concise voice persona
    const std::string sys_prompt =
        "你是用户桌面上贴心、自然、有人情味的墨水屏随身搭档。收到语音后，先干脆调用工具把事办妥，再用一句8到22字以内的自然口语回应（像熟人轻声搭话一样温暖利落，禁止Markdown星号井号、列表、Emoji、机械套话或逐条复读）。应用职责：" + role;

    cJSON* msgs = cJSON_CreateArray();
    auto add_msg = [&](const char* r, const char* txt) {
        cJSON* m = cJSON_CreateObject();
        cJSON_AddStringToObject(m, "role", r);
        cJSON_AddStringToObject(m, "content", txt ? txt : "");
        cJSON_AddItemToArray(msgs, m);
    };
    add_msg("system", sys_prompt.c_str());
    for (int i = 0; i < g_hist_count; ++i) {
        add_msg("user", g_hist[i].user.c_str());
        add_msg("assistant", g_hist[i].assistant.c_str());
    }
    time_t now_t = std::time(nullptr);
    char tbuf[64] = "未同步";
    if (now_t > 1700000000) {
        time_t cst = now_t + 28800;
        struct tm tm_now{}; gmtime_r(&cst, &tm_now);
        std::snprintf(tbuf, sizeof tbuf, "%04d-%02d-%02d %02d:%02d", tm_now.tm_year + 1900, tm_now.tm_mon + 1, tm_now.tm_mday, tm_now.tm_hour, tm_now.tm_min);
    }
    std::string user_turn = std::string("[当前时间 ") + tbuf + "]\n[看板状态]: " + state_json + "\n[用户语音]: " + utterance;
    add_msg("user", user_turn.c_str());

    cJSON* tools = cJSON_Parse(tools_raw.c_str());
    if (!cJSON_IsArray(tools)) { if (tools) cJSON_Delete(tools); tools = cJSON_CreateArray(); }
    const bool server_ds_search = g_vsearch && g_vthinking && c.kind == "dsh_token";
    if (server_ds_search) {
        cJSON* ws = cJSON_CreateObject(); cJSON_AddStringToObject(ws, "type", "deepseek_web_search");
        cJSON_AddItemToArray(tools, ws);
    } else if (g_vsearch) {
        cJSON* ws = cJSON_Parse("{\"type\":\"function\",\"function\":{\"name\":\"web_search\",\"description\":\"联网搜索实时新闻天气汇率百科\",\"parameters\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\",\"description\":\"搜索词\"}},\"required\":[\"query\"]}}}");
        cJSON* ru = cJSON_Parse("{\"type\":\"function\",\"function\":{\"name\":\"read_url\",\"description\":\"读取网页正文\",\"parameters\":{\"type\":\"object\",\"properties\":{\"url\":{\"type\":\"string\"}},\"required\":[\"url\"]}}}");
        if (ws) cJSON_AddItemToArray(tools, ws);
        if (ru) cJSON_AddItemToArray(tools, ru);
    }

    const int64_t turn_deadline = esp_timer_get_time() + 60000000LL;
    const int http_timeout = utterance.size() > 1000 ? 45000 : 25000;
    bool store_snapped = false, ok_done = false, omit_thinking_param = false;
    int local_tool_ok_cnt = 0, total_tools_used = 0;
    uint64_t last_hash = 0; int rep_count = 0;
    std::string final_reply;

    for (int step = 0; step < kMaxAgentSteps && !g_voice_abort.load() && esp_timer_get_time() < turn_deadline; ++step) {
        // Hard anti-runaway gate: on final step OR once 4 tools / repeat guard hit, strip "tools" to force final concise reply!
        const bool allow_tools_now = (step + 1 < kMaxAgentSteps) &&
                                     (total_tools_used < kMaxTotalToolsPerTurn) &&
                                     (rep_count < 2) &&
                                     (cJSON_GetArraySize(tools) > 0);
        cJSON* req = cJSON_CreateObject();
        cJSON_AddStringToObject(req, "model", c.model.empty() ? "deepseek-flash" : c.model.c_str());
        cJSON_AddNumberToObject(req, "max_tokens", 240);
        cJSON_AddNumberToObject(req, "temperature", 0.35);
        if (!omit_thinking_param) {
            cJSON* th = cJSON_CreateObject();
            cJSON_AddStringToObject(th, "type", (g_vthinking && allow_tools_now) ? "enabled" : "disabled");
            cJSON_AddItemToObject(req, "thinking", th);
        }
        cJSON_AddItemReferenceToObject(req, "messages", msgs);
        if (allow_tools_now) cJSON_AddItemReferenceToObject(req, "tools", tools);
        char* req_s = cJSON_PrintUnformatted(req);
        std::string req_body = req_s ? req_s : "{}";
        cJSON_free(req_s); cJSON_Delete(req);

        std::string resp;
        int code = post_json_abortable(build_v1_url(c, "/chat/completions"), c, req_body, resp, http_timeout);
        if (code == 400 && !omit_thinking_param && resp.find("thinking") != std::string::npos) {
            omit_thinking_param = true;
            --step;
            continue;
        }
        if (code != 200) {
            printf("NOTE4 AGENT {\"http_err\":%d,\"body\":\"%.160s\"}\n", code, resp.c_str());
            break;
        }
        cJSON* rj = cJSON_Parse(resp.c_str());
        cJSON* msg = rj ? cJSON_GetObjectItem(cJSON_GetArrayItem(cJSON_GetObjectItem(rj, "choices"), 0), "message") : nullptr;
        if (!msg) { if (rj) cJSON_Delete(rj); break; }

        const char* content_c = cJSON_IsString(cJSON_GetObjectItem(msg, "content")) ? cJSON_GetObjectItem(msg, "content")->valuestring : "";
        const char* reason_c = cJSON_IsString(cJSON_GetObjectItem(msg, "reasoning_content")) ? cJSON_GetObjectItem(msg, "reasoning_content")->valuestring : nullptr;
        cJSON* tcalls = cJSON_GetObjectItem(msg, "tool_calls");
        const int ntc = cJSON_IsArray(tcalls) ? cJSON_GetArraySize(tcalls) : 0;

        if (ntc <= 0) {
            final_reply = content_c;
            ok_done = true;
            cJSON_Delete(rj);
            break;
        }

        cJSON* am = cJSON_CreateObject();
        cJSON_AddStringToObject(am, "role", "assistant");
        cJSON_AddStringToObject(am, "content", content_c); // Never send null!
        if (reason_c && g_vthinking) cJSON_AddStringToObject(am, "reasoning_content", reason_c);
        cJSON_AddItemToObject(am, "tool_calls", cJSON_Duplicate(tcalls, true));
        cJSON_AddItemToArray(msgs, am);

        for (int ti = 0; ti < ntc && !g_voice_abort.load(); ++ti) {
            cJSON* tc = cJSON_GetArrayItem(tcalls, ti);
            const char* tcid = cJSON_IsString(cJSON_GetObjectItem(tc, "id")) ? cJSON_GetObjectItem(tc, "id")->valuestring : "call_0";
            cJSON* fn = cJSON_GetObjectItem(tc, "function");
            const std::string tname = fn && cJSON_IsString(cJSON_GetObjectItem(fn, "name")) ? cJSON_GetObjectItem(fn, "name")->valuestring : "";
            const std::string targs = fn && cJSON_IsString(cJSON_GetObjectItem(fn, "arguments")) ? cJSON_GetObjectItem(fn, "arguments")->valuestring : "{}";

            // DSH repeat-tool-guard (FNV-1a 64-bit) + per-trigger hard tool cap (kMaxTotalToolsPerTurn = 4)
            const uint64_t h64 = fnv1a64(tname, targs);
            if (h64 == last_hash) ++rep_count; else { last_hash = h64; rep_count = 1; }

            std::string tout;
            if (total_tools_used >= kMaxTotalToolsPerTurn || ti >= kMaxToolsPerStep) {
                tout = "{\"capped\":\"max_4_tools_per_turn_reached_reply_concisely_now\"}";
            } else if (rep_count >= 3) {
                tout = "{\"blocked\":\"identical_tool_called_3_times_stop_and_reply_concisely\"}";
            } else if (tname == "web_search" || tname == "read_url") {
                ++total_tools_used;
                tout = exec_builtin_web_tool(c, tname, targs, utterance);
            } else if (g_js_lock && xSemaphoreTake(g_js_lock, pdMS_TO_TICKS(3500)) == pdTRUE) {
                ++total_tools_used;
                if (!store_snapped) { js_agent_store_begin_turn(); store_snapped = true; }
                char obuf[2048];
                if (js_agent_call_tool(tname.c_str(), targs.c_str(), obuf, sizeof(obuf))) {
                    tout = obuf;
                    ++local_tool_ok_cnt;
                } else {
                    tout = "{\"error\":\"tool_exception\"}";
                }
                xSemaphoreGive(g_js_lock);
            } else {
                tout = "{\"error\":\"js_busy\"}";
            }
            if (rep_count == 2 && tout.size() < 1900) {
                tout += "\n[Hint: identical tool & args called twice; verify state and finish with concise reply]";
            }
            printf("NOTE4 AGENT {\"step\":%d,\"tool\":\"%s\",\"ok\":true}\n", step, tname.c_str());

            cJSON* tm_msg = cJSON_CreateObject();
            cJSON_AddStringToObject(tm_msg, "role", "tool");
            cJSON_AddStringToObject(tm_msg, "tool_call_id", tcid);
            cJSON_AddStringToObject(tm_msg, "content", tout.c_str());
            cJSON_AddItemToArray(msgs, tm_msg);
        }
        cJSON_Delete(rj);
    }

    cJSON_Delete(tools);
    cJSON_Delete(msgs);

    if (g_js_lock && xSemaphoreTake(g_js_lock, pdMS_TO_TICKS(3500)) == pdTRUE) {
        char custom_say[384];
        if (js_agent_take_say(custom_say, sizeof(custom_say)) && final_reply.empty()) final_reply = custom_say;
        if (g_voice_abort.load() || (!ok_done && local_tool_ok_cnt == 0)) {
            if (store_snapped) js_agent_store_rollback_turn();
            if (!g_voice_abort.load()) js_agent_emit("error", "请求超时或失败");
            else js_agent_emit("idle", "");
        } else {
            if (store_snapped) js_agent_store_commit_turn();
            if (final_reply.empty() && local_tool_ok_cnt > 0) final_reply = "已为你更新看板。";
            ok_done = true;
        }
        xSemaphoreGive(g_js_lock);
    }

    if (ok_done && !g_voice_abort.load()) {
        if (g_hist_count == 3) { g_hist[0] = g_hist[1]; g_hist[1] = g_hist[2]; g_hist_count = 2; }
        g_hist[g_hist_count++] = {utterance.substr(0, 200), final_reply.substr(0, 240)};
        printf("NOTE4 AGENT {\"done\":true,\"tools_ran\":%d,\"reply\":\"%.160s\"}\n", local_tool_ok_cnt, final_reply.c_str());
        stream_tts_reply(final_reply);
        if (g_js_lock && xSemaphoreTake(g_js_lock, pdMS_TO_TICKS(500)) == pdTRUE) {
            js_agent_emit(g_voice_abort.load() ? "idle" : "done", final_reply.c_str());
            xSemaphoreGive(g_js_lock);
        }
        return true;
    }
    return false;
}

std::string read_and_clear_transcript_doc() {
    FILE* f = std::fopen("/data/voice_tx.txt", "rb");
    if (!f) return {};
    std::fseek(f, 0, SEEK_END);
    long sz = std::ftell(f);
    std::rewind(f);
    std::string out;
    if (sz > 0) {
        size_t cap = std::min<size_t>(size_t(sz), 49152);
        out.resize(cap);
        size_t got = std::fread(out.data(), 1, cap, f);
        out.resize(got);
    }
    std::fclose(f);
    std::remove("/data/voice_tx.txt");
    while (!out.empty() && (out.back() == '\n' || out.back() == '\r' || out.back() == ' ')) out.pop_back();
    return out;
}

void finish_recording_session(bool was_long);

void process_sealed_slot(int sidx, bool is_long_chunk) {
    const size_t n_smp = g_slots[sidx].samples.load(std::memory_order_acquire);
    const uint32_t voiced = g_slots[sidx].voiced.load(std::memory_order_relaxed);
    const uint32_t pcm_bytes = uint32_t(n_smp * 2);
    const size_t wav_len = kWavHdrBytes + pcm_bytes;
    const int chunks_now = g_session_chunks.fetch_add(1, std::memory_order_relaxed) + 1;

    // Dual-track silence gate:
    // - Short PTT: accidental tap (<0.45s = 7200 samples) or pure ambient noise (<6 voiced blocks) -> silent drop (0 API cost).
    // - Long recording: silent chunk (<8 voiced blocks) ONLY frees the RAM slot (0 API cost) while keeping mic CONTINUOUSLY ON!
    const bool silent_drop = !g_mock_enabled.load(std::memory_order_relaxed) &&
                             (is_long_chunk ? (voiced < 8) : (n_smp < 7200 || voiced < 6));
    if (silent_drop) {
        const int sil_row = g_silent_chunks.fetch_add(1, std::memory_order_relaxed) + 1;
        printf("NOTE4 VOICE {\"asr_skipped_silence\":true,\"long\":%s,\"samples\":%u,\"voiced_blocks\":%lu,\"silent_chunks\":%d}\n",
               is_long_chunk ? "true" : "false", unsigned(n_smp), (unsigned long)voiced, sil_row);
        g_slots[sidx].samples.store(0, std::memory_order_relaxed);
        g_slots[sidx].voiced.store(0, std::memory_order_relaxed);
        g_slots[sidx].state.store(0, std::memory_order_release);
        if (is_long_chunk && chunks_now >= kMaxLongSessionChunks) {
            printf("NOTE4 VOICE {\"long_auto_stop\":\"max_60min_ceiling\",\"chunks\":%d}\n", chunks_now);
            finish_recording_session(true);
        }
        return;
    }

    g_silent_chunks.store(0, std::memory_order_relaxed);
    write_wav_header(g_slots[sidx].buf + kMpHeadMax, pcm_bytes);
    std::string txt;
    int http_code = 0;
    if (upload_asr_slot_buf(g_slots[sidx].buf, wav_len, txt, &http_code)) {
        append_transcript_doc(txt);
        if (g_long_mode.load(std::memory_order_relaxed)) led_pulse_chunk();
    } else if (!g_voice_abort.load() && n_smp >= 4000 && is_transient_asr_err(http_code)) {
        spool_slot_to_disk(g_slots[sidx].buf + kMpHeadMax, wav_len);
    } else if (http_code == 401 || http_code == 403) {
        g_voice_abort.store(true);
    }
    g_slots[sidx].samples.store(0, std::memory_order_relaxed);
    g_slots[sidx].voiced.store(0, std::memory_order_relaxed);
    g_slots[sidx].state.store(0, std::memory_order_release); // FREE immediately!
    if (g_long_mode.load(std::memory_order_relaxed) && chunks_now >= kMaxLongSessionChunks) {
        finish_recording_session(true);
    }
}

void voice_worker(void*) {
    bool holding_wifi = false;
    int64_t wifi_keep_until = 0;

    for (;;) {
        // 1. Check simulated utterance from USB / Studio
        std::string sim_u;
        {
            std::lock_guard<std::mutex> lk(g_sim_mu);
            if (g_sim_pending) { sim_u = std::move(g_sim_text); g_sim_pending = false; }
        }
        if (!sim_u.empty()) {
            const uint32_t my_gen = g_turn_gen.fetch_add(1, std::memory_order_acq_rel) + 1;
            g_voice_abort.store(false, std::memory_order_release);
            set_cpu_boost(true);
            if (!holding_wifi) { wifi_hold(true); holding_wifi = true; }
            voice_set_state_flags(false, true);
            g_phase.store(2, std::memory_order_release);
            led_set_mode(LedMode::THINK_BREATHE);
            bool ok = run_dsh_micro_agent(sim_u);
            if (g_turn_gen.load(std::memory_order_acquire) == my_gen && !g_recording.load(std::memory_order_acquire)) {
                voice_set_state_flags(false, false);
                if (g_voice_abort.load()) { led_set_mode(LedMode::IDLE_OFF); g_phase.store(0); }
                else if (!ok) { led_set_mode(LedMode::ERR_TRIPLE_BLINK); g_phase.store(4); }
                else { led_set_mode(LedMode::IDLE_OFF); g_phase.store(0); }
                set_cpu_boost(false);
            }
            wifi_keep_until = esp_timer_get_time() + 45000000LL;
            continue;
        }

        // 2. While recording: boost CPU to 240MHz, wake Wi-Fi (WIFI_PS_NONE), pre-warm TLS, drain SEALED chunks!
        if (g_recording.load(std::memory_order_acquire)) {
            set_cpu_boost(true);
            if (!holding_wifi) { wifi_hold(true); holding_wifi = true; }
            if (!g_mock_enabled.load() && !network_connected()) wifi_up(10000);
            if (!g_mock_enabled.load() && network_connected()) prewarm_tls_if_needed();
            for (int i = 0; i < 2 && !g_voice_abort.load(); ++i) {
                if (g_slots[i].state.load(std::memory_order_acquire) == 2) {
                    process_sealed_slot(i, true);
                }
            }
            vTaskDelay(pdMS_TO_TICKS(15));
            continue;
        }

        // 3. Finalize recording -> show instant uploading HUD -> flush active chunk -> run DSH-Micro Agent!
        if (g_finalize_rec.exchange(false, std::memory_order_acq_rel)) {
            const uint32_t my_gen = g_turn_gen.load(std::memory_order_acquire);
            const bool was_long_session = g_was_long_session.load(std::memory_order_relaxed);
            set_cpu_boost(true);
            if (!holding_wifi) { wifi_hold(true); holding_wifi = true; }
            voice_set_state_flags(false, true);
            g_phase.store(2, std::memory_order_release);
            led_set_mode(LedMode::THINK_BREATHE);
            if (g_js_lock && xSemaphoreTake(g_js_lock, pdMS_TO_TICKS(250)) == pdTRUE) {
                js_agent_emit("uploading", "识别中");
                xSemaphoreGive(g_js_lock);
            }

            for (int i = 0; i < 2 && !is_aborted(my_gen); ++i) {
                int st = g_slots[i].state.load(std::memory_order_acquire);
                if (st == 2 || (st == 1 && g_slots[i].samples.load() > 0)) {
                    process_sealed_slot(i, was_long_session);
                } else {
                    g_slots[i].samples.store(0); g_slots[i].state.store(0);
                }
            }
            if (!is_aborted(my_gen) && g_slots[0].buf) drain_spooled_wavs(g_slots[0].buf);
            std::string full_text = read_and_clear_transcript_doc();
            printf("NOTE4 VOICE {\"transcript_bytes\":%u,\"text\":\"%.160s\"}\n", unsigned(full_text.size()), full_text.c_str());

            bool ok = true;
            if (!is_aborted(my_gen) && !full_text.empty()) {
                ok = run_dsh_micro_agent(full_text);
            } else if (!is_aborted(my_gen) && full_text.empty()) {
                if (g_js_lock && xSemaphoreTake(g_js_lock, pdMS_TO_TICKS(400)) == pdTRUE) {
                    js_agent_emit("idle", "");
                    xSemaphoreGive(g_js_lock);
                }
            }
            // Only clear LED/HUD/boost if user did NOT barge-in into a brand-new recording!
            if (g_turn_gen.load(std::memory_order_acquire) == my_gen && !g_recording.load(std::memory_order_acquire)) {
                voice_set_state_flags(false, false);
                if (g_voice_abort.load()) {
                    if (g_js_lock && xSemaphoreTake(g_js_lock, pdMS_TO_TICKS(250)) == pdTRUE) {
                        js_agent_emit("idle", "");
                        xSemaphoreGive(g_js_lock);
                    }
                    led_set_mode(LedMode::IDLE_OFF);
                    g_phase.store(0);
                } else if (!ok) {
                    led_set_mode(LedMode::ERR_TRIPLE_BLINK);
                    g_phase.store(4);
                } else {
                    led_set_mode(LedMode::IDLE_OFF);
                    g_phase.store(0);
                }
                set_cpu_boost(false);
            }
            wifi_keep_until = esp_timer_get_time() + 45000000LL;
            continue;
        }

        set_cpu_boost(false);
        // Release temporary Wi-Fi hold after 45s idle if user configured periodic sleep
        if (holding_wifi && esp_timer_get_time() > wifi_keep_until) {
            if (network_sync_minutes() != SYNC_ALWAYS) ka_reset();
            wifi_hold(false);
            holding_wifi = false;
            if (network_sync_minutes() != SYNC_ALWAYS) wifi_down();
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

void start_recording_session(bool long_latch) {
    if (!ensure_slots_allocated()) { led_set_mode(LedMode::ERR_TRIPLE_BLINK); return; }
    g_turn_gen.fetch_add(1, std::memory_order_acq_rel);
    g_finalize_rec.store(false, std::memory_order_relaxed);
    std::remove("/data/voice_tx.txt");
    g_slots[0].samples.store(0); g_slots[0].voiced.store(0); g_slots[0].state.store(1); g_slots[0].seq = ++g_chunk_seq;
    g_slots[1].samples.store(0); g_slots[1].voiced.store(0); g_slots[1].state.store(0);
    g_write_idx.store(0, std::memory_order_release);
    g_silence_blocks.store(0);
    g_dropped_samples.store(0);
    g_session_chunks.store(0);
    g_silent_chunks.store(0);
    g_was_long_session.store(long_latch, std::memory_order_relaxed);
    g_long_mode.store(long_latch, std::memory_order_release);
    g_recording.store(true, std::memory_order_release);
    g_voice_abort.store(false, std::memory_order_release);
    g_phase.store(1, std::memory_order_release);
    voice_set_state_flags(long_latch, false);

    led_set_mode(long_latch ? LedMode::LONG_SOLID_100 : LedMode::PTT_ON_60);
    audio_play_cue(long_latch ? CUE_LONG_START : CUE_PTT_START);
    audio_mic_start(&mic_pcm_callback);

    if (g_js_lock && xSemaphoreTake(g_js_lock, pdMS_TO_TICKS(300)) == pdTRUE) {
        js_agent_emit("listening", long_latch ? "长录中" : "录音中");
        xSemaphoreGive(g_js_lock);
    }
}

void finish_recording_session(bool was_long) {
    if (!g_recording.exchange(false, std::memory_order_acq_rel)) return;
    audio_mic_stop();
    g_was_long_session.store(was_long, std::memory_order_relaxed);
    g_long_mode.store(false, std::memory_order_relaxed);
    voice_set_state_flags(false, true);
    audio_play_cue(was_long ? CUE_LONG_STOP : CUE_PTT_STOP);
    led_set_mode(LedMode::THINK_BREATHE);
    g_finalize_rec.store(true, std::memory_order_release);
}

} // namespace

void voice_agent_init(SemaphoreHandle_t runtime_lock) {
    g_js_lock = runtime_lock;
    esp_pm_lock_create(ESP_PM_CPU_FREQ_MAX, 0, "n4_voice_240", &g_pm_boost);
    load_cred_from_nvs();
    xTaskCreate(voice_worker, "n4_voice", 12288, nullptr, 4, nullptr);
}

void voice_agent_bind_work(const Work& w) {
    voice_agent_stop_all(false);
    if (w.kind != "js" || w.voice_mode == 0) {
        g_vmode = 0;
        voice_configure_keys(VOICE_KEY_OFF, true);
        return;
    }
    if (w.app_id != g_app_id) { g_app_id = w.app_id; g_hist_count = 0; }
    g_vmode = w.voice_mode;
    g_vtts = w.voice_tts;
    g_vsearch = w.voice_search;
    g_vthinking = w.voice_thinking;
    voice_configure_keys(static_cast<VoiceKeyMode>(w.voice_mode), w.voice_dbl_click);
}

void voice_agent_stop_all(bool play_cancel_cue) {
    g_turn_gen.fetch_add(1, std::memory_order_acq_rel);
    g_voice_abort.store(true, std::memory_order_release);
    g_recording.store(false, std::memory_order_release);
    g_long_mode.store(false, std::memory_order_release);
    g_finalize_rec.store(false, std::memory_order_release);
    audio_mic_stop();
    audio_tts_abort();
    voice_set_state_flags(false, false);
    led_set_mode(LedMode::IDLE_OFF);
    g_phase.store(0, std::memory_order_release);
    if (play_cancel_cue) audio_play_cue(CUE_CANCEL);
}

void voice_agent_on_bits(uint32_t bits) {
    if (g_vmode == 0) return;
    if (bits & INPUT_VOICE_CANCEL) {
        const bool has_barge_ptt = (bits & INPUT_VOICE_PTT_START) != 0;
        voice_agent_stop_all(!has_barge_ptt);
        if (!has_barge_ptt) return;
    }
    if ((bits & INPUT_VOICE_PTT_START) && !g_recording.load()) {
        start_recording_session(false);
    }
    if ((bits & INPUT_VOICE_PTT_STOP) && g_recording.load() && !g_long_mode.load()) {
        finish_recording_session(false);
    }
    if (bits & INPUT_VOICE_LONG_TOGGLE) {
        if (g_recording.load() && g_long_mode.load()) finish_recording_session(true);
        else if (!g_recording.load()) start_recording_session(true);
    }
}

bool voice_set_cred(const char* kind, const char* token, const char* base_url, const char* model, int64_t rev) {
    if (!kind || !token || std::strlen(token) < 6 || std::strlen(token) > 2048) return false;
    std::string k = std::strcmp(kind, "api_key") == 0 ? "api_key" : "dsh_token";
    std::string b = (base_url && base_url[0]) ? base_url : "https://api.deepseek.com";
    std::string m = (model && model[0]) ? model : "deepseek-flash";
    if (b.rfind("https://", 0) != 0 || b.size() > 240 || m.size() > 96) return false;
    nvs_handle_t h;
    if (nvs_open("n4_ai", NVS_READWRITE, &h) != ESP_OK) return false;
    bool ok = nvs_set_str(h, "kind", k.c_str()) == ESP_OK &&
              nvs_set_str(h, "token", token) == ESP_OK &&
              nvs_set_str(h, "base_url", b.c_str()) == ESP_OK &&
              nvs_set_str(h, "model", m.c_str()) == ESP_OK &&
              (rev <= 0 || nvs_set_i64(h, "rev", rev) == ESP_OK) &&
              nvs_commit(h) == ESP_OK;
    nvs_close(h);
    if (ok) {
        std::lock_guard<std::mutex> lk(g_cred_mu);
        g_cred.kind = k; g_cred.token = token; g_cred.base_url = b; g_cred.model = m;
        if (rev > 0) g_cred.rev = rev;
        g_ka_dirty.store(true, std::memory_order_release);
    }
    return ok;
}

bool voice_clear_cred(int64_t rev) {
    nvs_handle_t h;
    if (nvs_open("n4_ai", NVS_READWRITE, &h) != ESP_OK) return false;
    nvs_erase_all(h);
    if (rev > 0) nvs_set_i64(h, "rev", rev);
    bool ok = nvs_commit(h) == ESP_OK;
    nvs_close(h);
    std::lock_guard<std::mutex> lk(g_cred_mu);
    g_cred = AiCred{};
    if (rev > 0) g_cred.rev = rev;
    g_ka_dirty.store(true, std::memory_order_release);
    return ok;
}

bool voice_has_cred() { std::lock_guard<std::mutex> lk(g_cred_mu); return !g_cred.token.empty(); }
int64_t voice_cred_rev() { std::lock_guard<std::mutex> lk(g_cred_mu); return g_cred.rev; }
const char* voice_cred_kind() {
    std::lock_guard<std::mutex> lk(g_cred_mu);
    if (g_cred.token.empty()) return "none";
    return g_cred.kind == "api_key" ? "api_key" : "dsh_token";
}
const char* voice_phase_name() {
    switch (g_phase.load(std::memory_order_relaxed)) {
        case 1: return g_long_mode.load() ? "listening_long" : "listening_ptt";
        case 2: return "thinking";
        case 3: return "speaking";
        case 4: return "error";
        default: return "idle";
    }
}

void voice_sync_cred_if_needed(int64_t server_rev) {
    if (server_rev <= 0 || server_rev == voice_cred_rev()) return;
    std::string out;
    if (device_http("/api/device/ai-cred", "", out) != 200) return;
    cJSON* j = cJSON_Parse(out.c_str());
    if (!j) return;
    int64_t rev = cJSON_IsNumber(cJSON_GetObjectItem(j, "rev")) ? int64_t(cJSON_GetObjectItem(j, "rev")->valuedouble) : server_rev;
    if (cJSON_IsTrue(cJSON_GetObjectItem(j, "cleared"))) {
        // Wipes are forward-only: a stale clear rev must never erase a newer credential installed via USB or a fresher push.
        if (rev > voice_cred_rev()) {
            voice_clear_cred(rev);
            printf("NOTE4 VOICE {\"cred_synced\":\"cleared\",\"rev\":%lld}\n", (long long)rev);
        }
    } else {
        auto s = [&](const char* k) { auto* v = cJSON_GetObjectItem(j, k); return cJSON_IsString(v) ? v->valuestring : ""; };
        if (voice_set_cred(s("kind"), s("token"), s("base_url"), s("model"), rev)) {
            printf("NOTE4 VOICE {\"cred_synced\":\"%s\",\"rev\":%lld}\n", s("kind"), (long long)rev);
        }
    }
    cJSON_Delete(j);
}

bool voice_sim_utterance(const char* text) {
    if (!text || !text[0]) return false;
    std::lock_guard<std::mutex> lk(g_sim_mu);
    g_sim_text = text;
    g_sim_pending = true;
    return true;
}

void voice_set_mock(bool enabled, const char* mock_chunk_text) {
    g_mock_enabled.store(enabled, std::memory_order_release);
    if (mock_chunk_text && mock_chunk_text[0]) {
        std::lock_guard<std::mutex> lk(g_sim_mu);
        g_mock_chunk_text = mock_chunk_text;
    }
}

std::string voice_usb_diag(const char* action, int duration_ms) {
    std::string a = action ? action : "";
    if (a == "led_ptt") led_set_mode(LedMode::PTT_ON_60);
    else if (a == "led_long") led_set_mode(LedMode::LONG_SOLID_100);
    else if (a == "led_breathe") led_set_mode(LedMode::THINK_BREATHE);
    else if (a == "led_err") led_set_mode(LedMode::ERR_TRIPLE_BLINK);
    else if (a == "led_off") led_set_mode(LedMode::IDLE_OFF);
    else if (a == "cue_ptt_start") audio_play_cue(CUE_PTT_START);
    else if (a == "cue_ptt_stop") audio_play_cue(CUE_PTT_STOP);
    else if (a == "cue_long_start") audio_play_cue(CUE_LONG_START);
    else if (a == "cue_long_stop") audio_play_cue(CUE_LONG_STOP);
    else if (a == "cue_done") audio_play_cue(CUE_DONE);
    else if (a == "cue_cancel") audio_play_cue(CUE_CANCEL);
    else if (a == "tts_tone") play_mock_tts_cadence(120);
    else if (a == "rec_start_long") { g_fast_split_samples.store(0); g_vmode = 3; start_recording_session(true); }
    else if (a == "rec_start_fast_long") { g_fast_split_samples.store(duration_ms > 500 ? size_t(duration_ms * 16) : 48000u); g_vmode = 3; start_recording_session(true); }
    else if (a == "rec_stop_long") { g_fast_split_samples.store(0); finish_recording_session(true); }
    else if (a == "cancel") { voice_agent_stop_all(true); }
    else if (a == "rec_stress") {
        // Real mic + PSRAM Ping-Pong rolling-chunk stress test with mock ASR drain!
        const bool prev_mock = g_mock_enabled.load();
        g_mock_enabled.store(true);
        const uint32_t heap_before = esp_get_free_heap_size();
        const int dur = std::clamp(duration_ms > 0 ? duration_ms : 6000, 1000, 190000);
        ensure_slots_allocated();
        g_voice_abort.store(false);
        std::remove("/data/voice_tx.txt");
        g_slots[0].samples.store(0); g_slots[0].state.store(1); g_slots[0].seq = 1;
        g_slots[1].samples.store(0); g_slots[1].state.store(0);
        g_write_idx.store(0); g_dropped_samples.store(0);
        g_recording.store(true);
        audio_mic_start(&mic_pcm_callback);
        const int64_t t_end = esp_timer_get_time() + int64_t(dur) * 1000LL;
        int forced_splits = 0;
        while (esp_timer_get_time() < t_end && !g_voice_abort.load()) {
            int wi = g_write_idx.load();
            // Force chunk rotation every ~2s in fast stress mode (or natural 20-28s in long mode)
            const size_t split_at = dur <= 15000 ? 32000 : kSplitMinSamples;
            if (g_slots[wi].samples.load() >= split_at && g_slots[1 - wi].state.load() == 0) {
                seal_current_slot_from_mic(wi);
                ++forced_splits;
            }
            for (int s = 0; s < 2; ++s) if (g_slots[s].state.load() == 2) process_sealed_slot(s, true);
            vTaskDelay(pdMS_TO_TICKS(20));
        }
        g_recording.store(false);
        audio_mic_stop();
        for (int s = 0; s < 2; ++s) {
            if (g_slots[s].samples.load() > 0) process_sealed_slot(s, true);
            g_slots[s].state.store(0);
        }
        std::string tx = read_and_clear_transcript_doc();
        g_mock_enabled.store(prev_mock);
        const uint32_t heap_after = esp_get_free_heap_size();
        char rep[256];
        std::snprintf(rep, sizeof rep, "{\"ok\":true,\"action\":\"rec_stress\",\"ms\":%d,\"splits\":%d,\"dropped_samples\":%lu,\"tx_bytes\":%u,\"heap_before\":%lu,\"heap_after\":%lu}",
                      dur, forced_splits, (unsigned long)g_dropped_samples.load(), unsigned(tx.size()), (unsigned long)heap_before, (unsigned long)heap_after);
        return rep;
    }
    char out[192];
    std::snprintf(out, sizeof out, "{\"ok\":true,\"action\":\"%s\",\"led\":\"%s\",\"phase\":\"%s\",\"has_cred\":%s,\"cred_kind\":\"%s\",\"mock\":%s}",
                  a.c_str(), led_mode_name(), voice_phase_name(), voice_has_cred() ? "true" : "false", voice_cred_kind(), g_mock_enabled.load() ? "true" : "false");
    return out;
}

} // namespace note4
