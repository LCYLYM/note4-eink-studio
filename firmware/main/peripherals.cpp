#include "peripherals.hpp"
#include "led_cue.hpp"
#include "startup.hpp"
#include "runtime_control.hpp"
#include <atomic>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <cstdio>
#include <unistd.h>
#include <sys/stat.h>
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "gesture_audio.hpp"
#include "gesture_detector.hpp"
#include "zectrix_nfc.h"
#include "i2c_bus_lock.h"

// The board shares GPIO42 between codec power and the NFC I2C supply.
extern "C" void BoardI2cForcePowerOn() {
    gpio_hold_dis(GPIO_NUM_42); gpio_set_level(GPIO_NUM_42, 1); gpio_hold_en(GPIO_NUM_42);
}

namespace note4 { namespace {

constexpr char TAG[] = "note4_inputs";
constexpr float kTau = 6.283185307179586f;
constexpr size_t kTtsCap = 262144; // 512 KiB PSRAM = 10.92s @ 24kHz 16-bit mono

std::atomic<uint32_t> inputs{0};
std::atomic<int> feedback{0};
std::atomic<int64_t> feedback_at{0};
std::atomic<bool> wanted{false}, nfc_ok{false}, audio_ok{false}, bus_ok{false};

std::atomic<uint8_t> v_key_mode{VOICE_KEY_OFF};
std::atomic<bool> v_dbl_long{true}, v_long_rec{false}, v_busy{false};

std::atomic<uint8_t> req_cue{CUE_NONE};
std::atomic<bool> cue_playing{false};
std::atomic<AudioMicSink> mic_sink{nullptr};
std::atomic<bool> mic_active{false};

int16_t* tts_ring = nullptr;
std::atomic<size_t> tts_w{0}, tts_r{0}, tts_init_prebuf{14400};
std::atomic<bool> tts_active{false}, tts_eof{false}, tts_aborted{false};
std::atomic<uint32_t> tts_underrun_cnt{0};

portMUX_TYPE pa_guard = portMUX_INITIALIZER_UNLOCKED;
i2c_master_bus_handle_t bus = nullptr;
ZectrixNfc* nfc = nullptr;

void rail(gpio_num_t pin, int level) { gpio_hold_dis(pin); gpio_set_level(pin, level); gpio_hold_en(pin); }
void fault(const char* why) {
    audio_enable(false);
    audio_tts_abort();
    mic_sink.store(nullptr);
    inputs.fetch_or(128);
    ESP_LOGE(TAG, "audio stopped: %s", why);
}

void buttons(void*) {
    startup_ready(BUTTON_MANAGER);
    struct Button { gpio_num_t pin; uint32_t bit; bool raw=false, stable=false, long_sent=false, ptt_sent=false, cancel_eaten=false, barge_cancelled=false; int64_t changed=0, pressed=0; };
    Button keys[] = {{GPIO_NUM_0, 1}, {GPIO_NUM_39, 2}, {GPIO_NUM_18, 4}};
    int64_t ok_pending_click_at = 0;

    for (;;) {
        const int64_t now = esp_timer_get_time() / 1000;
        const auto vmode = static_cast<VoiceKeyMode>(v_key_mode.load(std::memory_order_relaxed));

        // Emit deferred single-click OK if double-click window (300ms) expired while OK is not pressed
        if (ok_pending_click_at > 0 && !keys[0].stable && !keys[0].raw && now - ok_pending_click_at >= 300) {
            ok_pending_click_at = 0;
            inputs.fetch_or(1);
        }

        for (auto& b : keys) {
            const bool down = !gpio_get_level(b.pin);
            if (down != b.raw) { b.raw = down; b.changed = now; }
            if (now - b.changed >= 22 && b.stable != b.raw) {
                b.stable = b.raw;
                if (b.stable) {
                    b.pressed = now; b.long_sent = false; b.ptt_sent = false; b.cancel_eaten = false; b.barge_cancelled = false;
                    if (b.pin == GPIO_NUM_0 && vmode != VOICE_KEY_OFF) {
                        // 1. Barge-in / Cancel: immediately mute speaker & abort active turn on keydown,
                        //    while STILL allowing >=260ms hold to transition seamlessly into new PTT recording!
                        if (v_busy.load(std::memory_order_relaxed)) {
                            b.barge_cancelled = true;
                            ok_pending_click_at = 0;
                            audio_tts_abort();
                            inputs.fetch_or(INPUT_VOICE_CANCEL);
                        }
                        // 2. Instant single-press stop while in latched long-recording
                        else if (v_long_rec.load(std::memory_order_relaxed)) {
                            b.cancel_eaten = true;
                            ok_pending_click_at = 0;
                            inputs.fetch_or(INPUT_VOICE_LONG_TOGGLE);
                        }
                        // 3. Snappy double-click detection on 2nd KEYDOWN (<= 360ms after 1st release!)
                        else if ((vmode == VOICE_KEY_LONG || vmode == VOICE_KEY_BOTH) &&
                                 v_dbl_long.load(std::memory_order_relaxed) &&
                                 ok_pending_click_at > 0 && now - ok_pending_click_at <= 360) {
                            b.cancel_eaten = true;
                            ok_pending_click_at = 0;
                            inputs.fetch_or(INPUT_VOICE_LONG_TOGGLE);
                        }
                    }
                } else {
                    if (b.pin == GPIO_NUM_0 && vmode != VOICE_KEY_OFF) {
                        if (b.cancel_eaten) continue;
                        if (b.ptt_sent) {
                            inputs.fetch_or(INPUT_VOICE_PTT_STOP);
                        } else if (b.barge_cancelled) {
                            // Released before 260ms hold -> pure stop/mute, do NOT trigger normal OK click
                            continue;
                        } else if (!b.long_sent) {
                            if (vmode == VOICE_KEY_LONG || vmode == VOICE_KEY_BOTH) {
                                if (!v_dbl_long.load(std::memory_order_relaxed)) {
                                    inputs.fetch_or(INPUT_VOICE_LONG_TOGGLE);
                                } else {
                                    ok_pending_click_at = now;
                                }
                            } else {
                                inputs.fetch_or(1);
                            }
                        }
                    } else if (!b.long_sent) {
                        inputs.fetch_or(b.bit);
                    }
                }
            }
            if (b.stable && !b.cancel_eaten) {
                if (b.pin == GPIO_NUM_0 && vmode != VOICE_KEY_OFF) {
                    // 260ms hold triggers PTT (including seamless barge-in right after interrupting TTS/thinking!)
                    if ((vmode == VOICE_KEY_PTT || vmode == VOICE_KEY_BOTH) && !b.ptt_sent && !v_long_rec.load(std::memory_order_relaxed) && now - b.pressed >= 260) {
                        b.ptt_sent = true;
                        ok_pending_click_at = 0;
                        inputs.fetch_or(INPUT_VOICE_PTT_START);
                    }
                } else if (!b.long_sent && now - b.pressed >= (b.pin == GPIO_NUM_39 ? 2000 : 800)) {
                    b.long_sent = true;
                    ok_pending_click_at = 0;
                    audio_enable(false);
                    audio_tts_abort();
                    mic_sink.store(nullptr);
                    inputs.fetch_or(b.pin == GPIO_NUM_39 ? 256 : 128);
                }
            }
        }
        vTaskDelay(pdMS_TO_TICKS(8));
    }
}
struct CueSpec { uint16_t f1, f2, f3; uint16_t total_frames; bool chord; bool drain_after; };
CueSpec cue_spec(CueTone t) {
    switch (t) {
        case CUE_PTT_START:  return {880, 1175, 0, 14, false, true};     // 70ms + 15ms RX drain
        case CUE_PTT_STOP:   return {988, 784, 0, 12, false, false};     // 60ms
        case CUE_LONG_START: return {660, 990, 1320, 22, false, true};   // 110ms + 15ms RX drain
        case CUE_LONG_STOP:  return {1175, 784, 0, 18, false, false};    // 90ms
        case CUE_DONE:       return {1047, 1319, 0, 16, true, false};    // 80ms C6+E6 chord
        case CUE_CANCEL:     return {440, 392, 0, 11, false, false};     // 55ms
        default:             return {0, 0, 0, 0, false, false};
    }
}

void render_cue_block(int16_t* out240, const CueSpec& s, uint16_t frame_idx, float& ph1, float& ph2) {
    const uint32_t total_smp = uint32_t(s.total_frames) * 240u;
    const uint32_t base_smp = uint32_t(frame_idx) * 240u;
    for (size_t i = 0; i < 240; ++i) {
        const uint32_t idx = base_smp + i;
        const float prog = float(idx) / float(std::max<uint32_t>(1, total_smp));
        float env = 1.0f;
        if (idx < 240) env = 0.5f - 0.5f * std::cos(3.14159265f * float(idx) / 240.0f);
        else if (total_smp - idx < 360) env = 0.5f - 0.5f * std::cos(3.14159265f * float(total_smp - idx) / 360.0f);
        float hz1 = s.f1, hz2 = s.f2;
        if (!s.chord) {
            if (s.f3 > 0) hz1 = prog < 0.34f ? s.f1 : (prog < 0.67f ? s.f2 : s.f3);
            else hz1 = prog < 0.5f ? s.f1 : s.f2;
            ph1 += kTau * hz1 / 48000.0f; if (ph1 >= kTau) ph1 -= kTau;
            out240[i] = int16_t(std::sin(ph1) * 12500.0f * env);
        } else {
            ph1 += kTau * hz1 / 48000.0f; if (ph1 >= kTau) ph1 -= kTau;
            ph2 += kTau * hz2 / 48000.0f; if (ph2 >= kTau) ph2 -= kTau;
            out240[i] = int16_t((std::sin(ph1) + 0.75f * std::sin(ph2)) * 7500.0f * env);
        }
    }
}

size_t tts_avail() {
    const size_t w = tts_w.load(std::memory_order_acquire);
    const size_t r = tts_r.load(std::memory_order_relaxed);
    return w - r;
}

void audio_worker(void*) {
    ugl::AudioCapture audio; ugl::Detector detector;
    bool active = false, voice_vol = false, pa_on = false, tts_prebuf_done = false, tts_rebuf = false;
    float us_phase = 0, cue_p1 = 0, cue_p2 = 0;
    constexpr float us_step = kTau * 21500.f / 48000.f;
    int16_t tx[240], rx[240], dec16k[80], us_buf[2048];
    int16_t tts_prev = 0;
    size_t us_filled = 0; uint32_t overruns = 0;
    CueSpec cur_cue{}; uint16_t cue_frame = 0, rx_drain = 0, us_holdoff = 0;

    auto set_pa = [&](bool on) {
        if (pa_on == on) return;
        portENTER_CRITICAL(&pa_guard);
        rail(GPIO_NUM_46, on ? 1 : 0);
        pa_on = on;
        portEXIT_CRITICAL(&pa_guard);
    };

    for (;;) {
        const uint8_t next_c = req_cue.exchange(CUE_NONE, std::memory_order_acq_rel);
        if (next_c != CUE_NONE) {
            cur_cue = cue_spec(static_cast<CueTone>(next_c));
            cue_frame = 0; cue_p1 = 0; cue_p2 = 0;
            cue_playing.store(cur_cue.total_frames > 0, std::memory_order_release);
        }
        const bool need_cue = cue_playing.load(std::memory_order_relaxed);
        const bool need_mic = mic_sink.load(std::memory_order_acquire) != nullptr;
        const bool need_tts = tts_active.load(std::memory_order_acquire) && !tts_aborted.load(std::memory_order_relaxed);
        const bool need_us  = wanted.load(std::memory_order_relaxed);

        if (!need_cue && !need_mic && !need_tts && !need_us && rx_drain == 0) {
            if (active || audio.initialized()) {
                set_pa(false); audio.Shutdown();
                active = false; voice_vol = false; audio_ok = false; mic_active = false;
                runtime_status_changed();
            }
            vTaskDelay(pdMS_TO_TICKS(15));
            continue;
        }
        if (!active) {
            rail(GPIO_NUM_42, 1); vTaskDelay(pdMS_TO_TICKS(15));
            esp_err_t err = audio.Init({}, bus);
            if (err == ESP_OK) err = audio.Start();
            if (err != ESP_OK) { fault(esp_err_to_name(err)); audio.Shutdown(); vTaskDelay(pdMS_TO_TICKS(50)); continue; }
            active = true; voice_vol = false; audio_ok = true; runtime_status_changed();
            us_filled = 0; us_phase = 0; overruns = audio.Overruns(); detector.Reset();
        }

        const bool want_audible = need_cue || need_tts;
        if (want_audible != voice_vol) {
            audio.SetOutputVolume(want_audible ? 84 : 20);
            voice_vol = want_audible;
            if (want_audible) {
                std::memset(tx, 0, sizeof(tx));
                audio.Write(tx, 240); // Prime silence before PA unmute
                tts_prev = 0; tts_prebuf_done = false; tts_rebuf = false;
            }
        }

        // Priority 1: Cue tone | Priority 2: Streaming 24kHz->48kHz TTS | Priority 3: Mic-only silence | Priority 4: Ultrasonic
        bool drive_pa = false;
        if (need_cue) {
            us_holdoff = 32; // 160ms ultrasonic warmup shield after audible activity
            render_cue_block(tx, cur_cue, cue_frame++, cue_p1, cue_p2);
            drive_pa = true;
            if (cue_frame >= cur_cue.total_frames) {
                cue_playing.store(false, std::memory_order_release);
                if (cur_cue.drain_after) rx_drain = 3; // 15ms acoustic tail drain before mic capture
            }
        } else if (need_tts && tts_ring) {
            us_holdoff = 32;
            const size_t avail = tts_avail();
            const size_t target_prebuf = tts_rebuf ? 9600u : tts_init_prebuf.load(std::memory_order_relaxed);
            if (!tts_prebuf_done && avail < target_prebuf && !tts_eof.load(std::memory_order_acquire)) {
                std::memset(tx, 0, sizeof(tx));
                drive_pa = pa_on; // Keep PA steady during brief rebuffer to avoid relay/pop click
            } else if (avail == 0 && tts_eof.load(std::memory_order_acquire)) {
                tts_active.store(false, std::memory_order_release);
                tts_prebuf_done = false; tts_rebuf = false; tts_prev = 0;
                std::memset(tx, 0, sizeof(tx));
            } else if (avail == 0) {
                // Rare mid-stream underrun: smooth cosine fade to 0 and re-accumulate 0.40s instead of stuttering!
                tts_underrun_cnt.fetch_add(1, std::memory_order_relaxed);
                for (size_t i = 0; i < 240; ++i) {
                    tx[i] = int16_t(float(tts_prev) * (1.0f - float(i + 1) / 240.0f));
                }
                tts_prev = 0;
                tts_prebuf_done = false;
                tts_rebuf = true;
                drive_pa = true;
            } else {
                tts_prebuf_done = true;
                tts_rebuf = false;
                drive_pa = true;
                size_t r = tts_r.load(std::memory_order_relaxed);
                const size_t take = std::min<size_t>(120, avail);
                for (size_t i = 0; i < 120; ++i) {
                    const int16_t cur = i < take ? tts_ring[(r + i) & (kTtsCap - 1)] : 0;
                    tx[i * 2] = int16_t((int32_t(tts_prev) + int32_t(cur)) / 2);
                    tx[i * 2 + 1] = cur;
                    tts_prev = cur;
                }
                tts_r.store(r + take, std::memory_order_release);
            }
        } else if (need_mic || rx_drain > 0) {
            us_holdoff = 32;
            std::memset(tx, 0, sizeof(tx));
            drive_pa = false; // PA strictly off during mic capture!
        } else {
            size_t count = std::min<size_t>(240, 2048 - us_filled);
            for (size_t i = 0; i < count; ++i) {
                tx[i] = int16_t(std::sin(us_phase) * 32767.f * 0.08f);
                us_phase += us_step; if (us_phase >= kTau) us_phase -= kTau;
            }
            if (audio.Write(tx, count) != int(count)) { fault("write"); continue; }
            set_pa(wanted.load(std::memory_order_relaxed));
            if (audio.Read(us_buf + us_filled, count) != int(count)) { fault("read"); continue; }
            if (us_holdoff > 0) {
                if (--us_holdoff == 0) { detector.Reset(); overruns = audio.Overruns(); }
                us_filled = 0;
                continue;
            }
            us_filled += count;
            if (us_filled == 2048) {
                ugl::DetectionStats stats; uint32_t next = audio.Overruns();
                auto ev = detector.Process(us_buf, us_filled, next - overruns, &stats);
                overruns = next; us_filled = 0;
                if (!wanted) continue;
                if (ev.type != ugl::EventType::kIdle) { feedback = int(ev.type); feedback_at = esp_timer_get_time(); }
                if (ev.type == ugl::EventType::kWave) inputs.fetch_or(8);
                else if (ev.type == ugl::EventType::kApproach) inputs.fetch_or(16);
                else if (ev.type == ugl::EventType::kRetreat) inputs.fetch_or(32);
            }
            continue;
        }

        if (!drive_pa) set_pa(false);
        if (audio.Write(tx, 240) != 240) { fault("write_v"); continue; }
        if (drive_pa) set_pa(true);
        if (audio.Read(rx, 240) != 240) { fault("read_v"); continue; }

        if (rx_drain > 0) { --rx_drain; mic_active = false; continue; }
        auto sink = mic_sink.load(std::memory_order_acquire);
        if (sink && !need_cue) {
            mic_active = true;
            // 3:1 boxcar anti-aliasing decimation (48000 Hz -> 16000 Hz, 80 samples / 5ms)
            for (size_t i = 0; i < 80; ++i) {
                int32_t acc = int32_t(rx[i * 3]) + int32_t(rx[i * 3 + 1]) + int32_t(rx[i * 3 + 2]);
                dec16k[i] = int16_t(acc / 3);
            }
            sink(dec16k, 80);
        } else {
            mic_active = false;
        }
        us_filled = 0;
    }
}

}} // namespace note4::<anon>

namespace note4 {

void audio_enable(bool enabled) {
    portENTER_CRITICAL(&pa_guard);
    wanted = enabled;
    if (!enabled && !cue_playing.load() && !tts_active.load()) rail(GPIO_NUM_46, 0);
    portEXIT_CRITICAL(&pa_guard);
}
void voice_configure_keys(VoiceKeyMode mode, bool double_click_long) {
    v_key_mode.store(static_cast<uint8_t>(mode), std::memory_order_relaxed);
    v_dbl_long.store(double_click_long, std::memory_order_relaxed);
    if (mode == VOICE_KEY_OFF) { v_long_rec.store(false); v_busy.store(false); }
}
void voice_set_state_flags(bool long_recording, bool busy_cancellable) {
    v_long_rec.store(long_recording, std::memory_order_relaxed);
    v_busy.store(busy_cancellable, std::memory_order_relaxed);
}
void audio_play_cue(CueTone cue) {
    cue_playing.store(cue != CUE_NONE, std::memory_order_release);
    req_cue.store(static_cast<uint8_t>(cue), std::memory_order_release);
}
bool audio_cue_busy() { return cue_playing.load(std::memory_order_acquire) || req_cue.load(std::memory_order_acquire) != CUE_NONE; }
void audio_mic_start(AudioMicSink sink) { mic_sink.store(sink, std::memory_order_release); }
void audio_mic_stop() { mic_sink.store(nullptr, std::memory_order_release); mic_active.store(false); }
bool audio_mic_capturing() { return mic_active.load(std::memory_order_acquire); }

bool audio_tts_begin(size_t initial_prebuf_samples) {
    if (!tts_ring) tts_ring = static_cast<int16_t*>(heap_caps_malloc(kTtsCap * sizeof(int16_t), MALLOC_CAP_SPIRAM));
    if (!tts_ring) return false;
    tts_init_prebuf.store(std::clamp<size_t>(initial_prebuf_samples, 4800u, 24000u), std::memory_order_relaxed);
    tts_w.store(0, std::memory_order_relaxed);
    tts_r.store(0, std::memory_order_relaxed);
    tts_underrun_cnt.store(0, std::memory_order_relaxed);
    tts_eof.store(false, std::memory_order_relaxed);
    tts_aborted.store(false, std::memory_order_relaxed);
    tts_active.store(true, std::memory_order_release);
    return true;
}
size_t audio_tts_push(const int16_t* pcm24k, size_t samples, uint32_t timeout_ms) {
    if (!tts_ring || !pcm24k || !samples) return 0;
    size_t pushed = 0;
    const int64_t deadline = esp_timer_get_time() + int64_t(timeout_ms) * 1000LL;
    while (pushed < samples && !tts_aborted.load(std::memory_order_acquire) && tts_active.load(std::memory_order_acquire)) {
        const size_t w = tts_w.load(std::memory_order_relaxed);
        const size_t r = tts_r.load(std::memory_order_acquire);
        const size_t free_sp = kTtsCap - (w - r);
        if (free_sp == 0) {
            if (esp_timer_get_time() >= deadline) break;
            vTaskDelay(pdMS_TO_TICKS(5));
            continue;
        }
        const size_t chunk = std::min(samples - pushed, free_sp);
        for (size_t i = 0; i < chunk; ++i) tts_ring[(w + i) & (kTtsCap - 1)] = pcm24k[pushed + i];
        tts_w.store(w + chunk, std::memory_order_release);
        pushed += chunk;
    }
    return pushed;
}
void audio_tts_finish() { tts_eof.store(true, std::memory_order_release); }
void audio_tts_abort() {
    portENTER_CRITICAL(&pa_guard);
    tts_aborted.store(true, std::memory_order_release);
    tts_active.store(false, std::memory_order_release);
    if (!wanted.load(std::memory_order_relaxed) && !cue_playing.load(std::memory_order_relaxed)) rail(GPIO_NUM_46, 0);
    portEXIT_CRITICAL(&pa_guard);
}
bool audio_tts_playing() { return tts_active.load(std::memory_order_acquire) && !tts_aborted.load(std::memory_order_acquire); }
uint32_t audio_tts_underruns() { return tts_underrun_cnt.load(std::memory_order_relaxed); }

bool nfc_ready() { return nfc_ok; }
bool audio_ready() { return audio_ok; }
bool input_bus_ready() { return bus_ok; }
uint32_t take_inputs() { return inputs.exchange(0); }

const char* gesture_feedback() {
    if (!wanted) return "US:OFF";
    if (!audio_ok) return "US:START";
    if (esp_timer_get_time() - feedback_at.load() > 450000) return "US:IDLE";
    switch (ugl::EventType(feedback.load())) {
        case ugl::EventType::kWave: return "US:WAVE";
        case ugl::EventType::kApproach: return "US:NEAR";
        case ugl::EventType::kRetreat: return "US:AWAY";
        case ugl::EventType::kInvalid: return "US:INVALID";
        default: return "US:IDLE";
    }
}

void peripherals_init() {
    gpio_config_t outputs{}; outputs.pin_bit_mask = (1ULL << 42) | (1ULL << 46); outputs.mode = GPIO_MODE_INPUT_OUTPUT;
    ESP_ERROR_CHECK(gpio_config(&outputs)); rail(GPIO_NUM_46, 0); rail(GPIO_NUM_42, 1);
    gpio_config_t cfg{}; cfg.pin_bit_mask = (1ULL << 0) | (1ULL << 39) | (1ULL << 18); cfg.mode = GPIO_MODE_INPUT; cfg.pull_up_en = GPIO_PULLUP_ENABLE;
    ESP_ERROR_CHECK(gpio_config(&cfg));
    led_power_init();
    if (xTaskCreate(buttons, "note4_buttons", 3072, nullptr, 8, nullptr) != pdPASS) { startup_failed("button_task_create"); return; }
    i2c_master_bus_config_t i2c{}; i2c.i2c_port = I2C_NUM_0; i2c.sda_io_num = GPIO_NUM_47; i2c.scl_io_num = GPIO_NUM_48;
    i2c.clk_source = I2C_CLK_SRC_DEFAULT; i2c.glitch_ignore_cnt = 7; i2c.flags.enable_internal_pullup = 1;
    if (i2c_new_master_bus(&i2c, &bus) != ESP_OK) { ESP_LOGE(TAG, "I2C unavailable; buttons remain live"); return; }
    bus_ok = true; nfc = new ZectrixNfc(bus, 0x55, GPIO_NUM_21, GPIO_NUM_7, 0);
    if (nfc->Init()) { nfc_ok = true; nfc->SetFieldCallback([](bool present) { if (present) inputs.fetch_or(64); }); }
    else ESP_LOGW(TAG, "NFC init failed; no NFC writes attempted");
    if (xTaskCreate(audio_worker, "note4_audio", 16384, nullptr, 5, nullptr) != pdPASS) startup_failed("audio_task_create");
}

bool nfc_write_url(const char* url) {
    if (!nfc || !url || std::strncmp(url, "https://", 8) != 0 || std::strlen(url) > 300 || std::strchr(url, '\n')) return false;
    if (std::strstr(url, "token=") || std::strstr(url, "secret=")) return false;
    ScopedI2cBusLock lock("note4_nfc_commission"); if (!lock.locked() || nfc->HasField()) return false;
    uint8_t backup[ZectrixNfc::kUserDataCapacity];
    struct stat st{};
    if (stat("/data/nfc-backup.bin", &st) != 0) {
        if (nfc->ReadUserData(0, backup, sizeof(backup)) != ESP_OK) return false;
        FILE* file = std::fopen("/data/nfc-backup.tmp", "wb"); if (!file) return false;
        bool ok = std::fwrite(backup, 1, sizeof(backup), file) == sizeof(backup);
        ok = std::fflush(file) == 0 && ok; ok = fsync(fileno(file)) == 0 && ok; ok = std::fclose(file) == 0 && ok;
        if (!ok || std::rename("/data/nfc-backup.tmp", "/data/nfc-backup.bin") != 0) return false;
    } else if (st.st_size != sizeof(backup)) return false;
    return nfc->WriteUriNdef(url) == ESP_OK;
}

bool nfc_restore_userdata() {
    if (!nfc || nfc->HasField()) return false;
    uint8_t backup[ZectrixNfc::kUserDataCapacity];
    FILE* file = std::fopen("/data/nfc-backup.bin", "rb"); if (!file) return false;
    size_t got = std::fread(backup, 1, sizeof(backup), file); int extra = std::fgetc(file); std::fclose(file);
    if (got != sizeof(backup) || extra != EOF) return false;
    ScopedI2cBusLock lock("note4_nfc_restore"); if (!lock.locked() || nfc->HasField()) return false;
    return nfc->WriteUserData(0, backup, sizeof(backup)) == ESP_OK;
}

} // namespace note4
