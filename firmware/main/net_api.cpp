#include "net_api.h"
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <mutex>
#include <string>
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_timer.h"

namespace {
constexpr size_t RESPONSE_MAX = 128 * 1024, KEEP_BYTES = 128 * 1024;
constexpr int QUEUE_MAX = 48, KEEP_PER_APP = 16, KEEP_MAX = 32, SHORT_MAX = 16, REPLY_MAX = 8, LIMIT_SLOTS = 16;
constexpr int64_t SAME_KEY_US = 60000000;
struct Req { char app[9], key[17]; bool keep, user, tried, saved, busy; uint32_t seq, round, body_len, blob_len; char *blob; };
struct Reply { char app[9], key[17]; int status; char *body; size_t len; };
struct Sent { char app[9], key[17]; int64_t at; };
struct Buf { char *data; size_t len; bool over; };
struct FileHead { uint32_t magic, seq, body_len, blob_len; char app[9], key[17]; };
constexpr uint32_t MAGIC = 0x3151344e;
std::mutex lock;
Req *queue[QUEUE_MAX];
int count;
Reply replies[REPLY_MAX];
int reply_count;
Sent sent[LIMIT_SLOTS];
uint32_t next_seq = 1, round_no;
size_t keep_bytes;
char current[9];

char *psram(size_t n) { return static_cast<char *>(heap_caps_malloc(n ? n : 1, MALLOC_CAP_SPIRAM)); }
const char *method_of(const Req *r) { return r->blob + strlen(r->blob) + 1; }
const char *headers_of(const Req *r) { const char *m = method_of(r); return m + strlen(m) + 1; }
const char *body_of(const Req *r) { const char *h = headers_of(r); return h + strlen(h) + 1; }
void path_of(const Req *r, char *out, size_t n) { snprintf(out, n, "/data/nq_%08lx", (unsigned long)r->seq); }
bool same(const char *a, const char *b, size_t n) { return !strncmp(a, b, n); }

void remove_at(int i) {
    Req *r = queue[i];
    if (r->keep) keep_bytes -= r->blob_len;
    free(r->blob); free(r);
    for (; i + 1 < count; i++) queue[i] = queue[i + 1];
    --count;
}
void post_reply(const Req *r, int status, const char *body, size_t len) {
    if (strcmp(r->app, current)) return;
    char *copy = psram(len + 1);
    if (!copy) { status = -1; len = 0; copy = psram(1); if (!copy) return; }
    if (len) memcpy(copy, body, len);
    copy[len] = 0;
    int i = 0;
    while (i < reply_count && !(same(replies[i].app, r->app, 9) && same(replies[i].key, r->key, 17))) ++i;
    if (i == reply_count) {
        if (reply_count == REPLY_MAX) { free(replies[0].body); memmove(replies, replies + 1, sizeof(Reply) * (REPLY_MAX - 1)); --reply_count; --i; }
        ++reply_count;
    } else free(replies[i].body);
    Reply &o = replies[i];
    memcpy(o.app, r->app, 9); memcpy(o.key, r->key, 17); o.status = status; o.body = copy; o.len = len;
}
bool limited(const Req *r, int64_t now) {
    for (auto &s : sent) if (s.at && same(s.app, r->app, 9) && same(s.key, r->key, 17)) return now - s.at < SAME_KEY_US;
    return false;
}
void remember(const Req *r, int64_t now) {
    Sent *pick = sent;
    for (auto &s : sent) { if (same(s.app, r->app, 9) && same(s.key, r->key, 17)) { pick = &s; break; } if (s.at < pick->at) pick = &s; }
    memcpy(pick->app, r->app, 9); memcpy(pick->key, r->key, 17); pick->at = now;
}
esp_err_t on_data(esp_http_client_event_t *e) {
    if (e->event_id != HTTP_EVENT_ON_DATA) return ESP_OK;
    int code = esp_http_client_get_status_code(e->client);
    if (code >= 300 && code < 400) return ESP_OK; // body of a redirect that is being followed
    auto *b = static_cast<Buf *>(e->user_data);
    if (b->len + e->data_len > RESPONSE_MAX) { b->over = true; return ESP_OK; }
    memcpy(b->data + b->len, e->data, e->data_len);
    b->len += e->data_len;
    return ESP_OK;
}
std::string origin_of(const char *url) { const char *p = strstr(url, "://"); if (!p) return url; const char *e = strpbrk(p + 3, "/?#"); return e ? std::string(url, e - url) : std::string(url); }
struct Conn { esp_http_client_handle_t h; std::string origin; };
void conn_close(Conn &c) { if (c.h) esp_http_client_cleanup(c.h); c.h = nullptr; c.origin.clear(); }
esp_http_client_method_t method_value(const char *m) {
    if (!strcmp(m, "POST")) return HTTP_METHOD_POST;
    if (!strcmp(m, "PUT")) return HTTP_METHOD_PUT;
    if (!strcmp(m, "DELETE")) return HTTP_METHOD_DELETE;
    if (!strcmp(m, "PATCH")) return HTTP_METHOD_PATCH;
    if (!strcmp(m, "HEAD")) return HTTP_METHOD_HEAD;
    return HTTP_METHOD_GET;
}
int perform(Conn &c, const Req *r, Buf &b) {
    std::string origin = origin_of(r->blob);
    if (c.h && c.origin != origin) conn_close(c);
    if (!c.h) {
        esp_http_client_config_t cfg{};
        cfg.url = r->blob; cfg.timeout_ms = 10000; cfg.event_handler = on_data; cfg.user_data = &b; cfg.keep_alive_enable = true;
        cfg.buffer_size = 2048; cfg.buffer_size_tx = 2048; cfg.max_redirection_count = 5; cfg.user_agent = "NOTE4";
        cfg.crt_bundle_attach = esp_crt_bundle_attach;
        c.h = esp_http_client_init(&cfg);
        if (!c.h) return 0;
        c.origin = origin;
    }
    esp_http_client_set_url(c.h, r->blob);
    esp_http_client_set_user_data(c.h, &b);
    esp_http_client_set_method(c.h, method_value(method_of(r)));
    esp_http_client_set_post_field(c.h, r->body_len ? body_of(r) : nullptr, r->body_len);
    std::string names, headers = headers_of(r);
    for (size_t at = 0; at < headers.size();) {
        size_t end = headers.find('\n', at); if (end == std::string::npos) end = headers.size();
        std::string line = headers.substr(at, end - at); at = end + 1;
        size_t colon = line.find(':'); if (colon == std::string::npos) continue;
        size_t v = line.find_first_not_of(" \t", colon + 1);
        std::string name = line.substr(0, colon), value = v == std::string::npos ? "" : line.substr(v);
        while (!value.empty() && value.back() == '\r') value.pop_back();
        esp_http_client_set_header(c.h, name.c_str(), value.c_str());
        names += name; names += '\n';
    }
    esp_err_t err = esp_http_client_perform(c.h);
    int status = err == ESP_OK ? esp_http_client_get_status_code(c.h) : 0;
    if (err != ESP_OK) conn_close(c);
    else for (size_t at = 0; at < names.size();) { size_t end = names.find('\n', at); esp_http_client_delete_header(c.h, names.substr(at, end - at).c_str()); at = end + 1; }
    return status;
}
void save_one(Req *r) {
    char path[32], tmp[36];
    path_of(r, path, sizeof path); snprintf(tmp, sizeof tmp, "%s.t", path);
    FILE *f = fopen(tmp, "wb");
    r->saved = true; // a failed write leaves it in RAM only; retrying every 200 ms would hammer flash
    if (!f) return;
    FileHead h{MAGIC, r->seq, r->body_len, r->blob_len, {}, {}};
    memcpy(h.app, r->app, 9); memcpy(h.key, r->key, 17);
    bool ok = fwrite(&h, sizeof h, 1, f) == 1 && fwrite(r->blob, 1, r->blob_len, f) == r->blob_len;
    ok = fclose(f) == 0 && ok;
    if (ok) ok = rename(tmp, path) == 0;
    if (!ok) remove(tmp);
}
}

extern "C" bool n4_net_enqueue(const char *app, const char *key, const char *url, const char *method, const char *headers, const char *body, size_t body_len, bool keep, bool user) {
    size_t a = strlen(url) + 1, b = strlen(method) + 1, c = strlen(headers) + 1, blob_len = a + b + c + body_len + 1;
    char *blob = psram(blob_len);
    if (!blob) return false;
    memcpy(blob, url, a); memcpy(blob + a, method, b); memcpy(blob + a + b, headers, c);
    if (body_len) memcpy(blob + a + b + c, body, body_len);
    blob[blob_len - 1] = 0;
    std::lock_guard<std::mutex> guard(lock);
    if (!keep) for (int i = 0; i < count; i++) if (!queue[i]->keep && !queue[i]->busy && !strcmp(queue[i]->app, app) && !strcmp(queue[i]->key, key)) {
        free(queue[i]->blob); Req *r = queue[i]; r->blob = blob; r->blob_len = blob_len; r->body_len = body_len; r->user = r->user || user; r->seq = next_seq++;
        return true;
    }
    int same_app = 0, kept = 0, short_lived = 0;
    for (int i = 0; i < count; i++) { if (queue[i]->keep) { ++kept; same_app += !strcmp(queue[i]->app, app); } else ++short_lived; }
    if (count == QUEUE_MAX || (keep ? same_app >= KEEP_PER_APP || kept >= KEEP_MAX || keep_bytes + blob_len > KEEP_BYTES : short_lived >= SHORT_MAX)) { free(blob); return false; }
    Req *r = static_cast<Req *>(heap_caps_calloc(1, sizeof(Req), MALLOC_CAP_SPIRAM));
    if (!r) { free(blob); return false; }
    snprintf(r->app, sizeof r->app, "%s", app); snprintf(r->key, sizeof r->key, "%s", key);
    r->keep = keep; r->user = user; r->saved = !keep; r->seq = next_seq++; r->body_len = body_len; r->blob_len = blob_len; r->blob = blob;
    if (keep) keep_bytes += blob_len;
    queue[count++] = r;
    return true;
}
extern "C" void n4_net_app(const char *app) {
    std::lock_guard<std::mutex> guard(lock);
    snprintf(current, sizeof current, "%s", app);
    for (int i = count - 1; i >= 0; i--) if (!queue[i]->keep && !queue[i]->busy) remove_at(i);
    for (int i = 0; i < reply_count; i++) free(replies[i].body);
    reply_count = 0;
}
extern "C" bool n4_net_take(const char *app, char *key, int *status, char **body, size_t *len) {
    std::lock_guard<std::mutex> guard(lock);
    if (!reply_count) return false;
    Reply o = replies[0];
    memmove(replies, replies + 1, sizeof(Reply) * (--reply_count));
    if (strcmp(o.app, app)) { free(o.body); return false; }
    memcpy(key, o.key, 17); *status = o.status; *body = o.body; *len = o.len;
    return true;
}

namespace note4 {
void net_api_init() {
    DIR *d = opendir("/data");
    if (!d) return;
    char path[300];
    while (auto *e = readdir(d)) {
        if (strncmp(e->d_name, "nq_", 3)) continue;
        snprintf(path, sizeof path, "/data/%s", e->d_name);
        size_t n = strlen(path);
        if (n > 2 && !strcmp(path + n - 2, ".t")) { remove(path); continue; }
        FILE *f = fopen(path, "rb");
        FileHead h{};
        Req *r = nullptr;
        if (f && fread(&h, sizeof h, 1, f) == 1 && h.magic == MAGIC && h.blob_len > 0 && h.blob_len < 32768 && h.body_len < h.blob_len && count < QUEUE_MAX) {
            r = static_cast<Req *>(heap_caps_calloc(1, sizeof(Req), MALLOC_CAP_SPIRAM));
            if (r) r->blob = psram(h.blob_len);
            if (r && (!r->blob || fread(r->blob, 1, h.blob_len, f) != h.blob_len)) { free(r->blob); free(r); r = nullptr; }
            // A corrupt file must not let body_of()/strlen walk past the blob: require the
            // url\0method\0headers\0 layout and exactly body_len bytes before the trailing NUL.
            if (r) {
                const char *q = r->blob, *end = r->blob + h.blob_len - 1;
                for (int i = 0; i < 3 && q; i++) { const char *z = static_cast<const char *>(memchr(q, 0, end - q)); q = z ? z + 1 : nullptr; }
                if (!q || (size_t)(end - q) != h.body_len) { free(r->blob); free(r); r = nullptr; }
            }
        }
        if (f) fclose(f);
        if (!r) { remove(path); continue; }
        memcpy(r->app, h.app, 9); memcpy(r->key, h.key, 17);
        r->app[8] = 0; r->key[16] = 0; r->keep = true; r->saved = true; r->seq = h.seq; r->body_len = h.body_len; r->blob_len = h.blob_len;
        std::lock_guard<std::mutex> guard(lock);
        int at = count++;
        while (at > 0 && queue[at - 1]->seq > r->seq) { queue[at] = queue[at - 1]; --at; }
        queue[at] = r; keep_bytes += r->blob_len; next_seq = std::max(next_seq, r->seq + 1);
    }
    closedir(d);
    printf("NOTE4 NET {\"retained\":%d}\n", count);
}
bool net_api_wants(bool user_only) {
    std::lock_guard<std::mutex> guard(lock);
    for (int i = 0; i < count; i++) if ((!queue[i]->keep || !queue[i]->tried) && (!user_only || queue[i]->user)) return true;
    return false;
}
void net_api_save() {
    for (;;) {
        Req *r = nullptr;
        { std::lock_guard<std::mutex> guard(lock); for (int i = 0; i < count && !r; i++) if (!queue[i]->saved) r = queue[i]; }
        if (!r) return;
        save_one(r); // retained entries are removed only on this task, so r stays valid
    }
}
void net_api_drain(bool always, bool window) {
    net_api_save();
    uint32_t this_round = ++round_no;
    bool keep_blocked = false;
    Conn conn{nullptr, {}};
    Buf buf{nullptr, 0, false};
    int total = 0, failed = 0;
    for (;;) {
        Req *r = nullptr;
        int64_t now = esp_timer_get_time();
        {
            std::lock_guard<std::mutex> guard(lock);
            for (int i = 0; i < count && !r; i++) {
                Req *q = queue[i];
                if (q->round == this_round || (q->keep && keep_blocked) || (always && !q->keep && limited(q, now)) || (!window && q->keep && q->tried)) continue;
                q->busy = true; q->round = this_round; r = q;
            }
        }
        if (!r) break;
        if (!buf.data && !(buf.data = psram(RESPONSE_MAX + 1))) { std::lock_guard<std::mutex> guard(lock); r->busy = false; break; }
        buf.len = 0; buf.over = false;
        int status = perform(conn, r, buf);
        if (buf.over) status = -1;
        ++total; failed += status <= 0;
        std::lock_guard<std::mutex> guard(lock);
        r->busy = false;
        bool done = !r->keep || (status >= 200 && status < 500) || status == -1;
        if (!r->keep) remember(r, now);
        if (done) {
            post_reply(r, status, status > 0 ? buf.data : "", status > 0 ? buf.len : 0);
            if (r->keep) { char path[32]; path_of(r, path, sizeof path); remove(path); }
            for (int i = 0; i < count; i++) if (queue[i] == r) { remove_at(i); break; }
        } else { r->tried = true; keep_blocked = true; }
    }
    conn_close(conn);
    free(buf.data);
    if (total) printf("NOTE4 NET {\"sent\":%d,\"failed\":%d}\n", total, failed);
}
void net_api_offline() {
    std::lock_guard<std::mutex> guard(lock);
    for (int i = count - 1; i >= 0; i--) {
        if (queue[i]->keep) queue[i]->tried = true;
        else if (!queue[i]->busy) { post_reply(queue[i], 0, "", 0); remove_at(i); }
    }
}
}
