// Device-side JS probe: MicroQuickJS plus native drawing, keys and storage.
// Network access goes through net.request; the net task sends requests during Wi-Fi windows.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <inttypes.h>
#include <sys/time.h>
#include <unistd.h>
#include <dirent.h>
#include <sys/stat.h>
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "miniz.h"
#include "cutils.h"
#include "mquickjs.h"
#include "js_app.h"
#include "net_api.h"

#define FB_SIZE 60000
#define JS_HEAP_SIZE (512 * 1024)
#define HANDLER_US 1000000
#define NET_HANDLER_US 3000000 // JSON.parse of a large reply on PSRAM
#define START_US 3000000
#define VALUE_MAX 4096
#define STORE_QUOTA (256 * 1024)
#define PENDING_MAX 16
#define FLUSH_DELAY_MS 3000
#define FULL_REFRESH_EVERY 30 // partial refreshes before a black-flash rebase clears ghosting

extern const uint8_t font_start[] asm("_binary_js_font16_bin_start");
extern const char app_start[] asm("_binary_js_probe_app_js_start");
extern const char app_end[] asm("_binary_js_probe_app_js_end");

static JSContext *ctx;
static uint8_t *mem, *fb, *fb2;
static volatile bool dirty;
static bool waiting_refresh;
static int64_t deadline, present_at, last_busy;
static char injected[16];
static char app_ns[9];
static bool dots_mode = true, force_clear;
static int refresh_mode;
static int fast_count;
static FILE *asset;
static char asset_path[64];
static uint32_t asset_at, next_asset_at;
static int asset_count, asset_bytes, next_count, next_bytes, tick_ms;
static int64_t next_tick;
static uint32_t *frame_table;
static uint8_t *frame_packed;
static tinfl_decompressor *frame_decoder;
static bool next_deflated;
static bool quiet, user_call;
typedef struct { char path[44]; char *data; size_t len; } pending_t;
static pending_t pending[PENDING_MAX];
static int npending;
static int64_t last_set_ms;
static size_t store_used;
static int64_t mono_ms(void) { return esp_timer_get_time() / 1000; }

#include "mqjs_host_funcs.inc"

#include "js_ui.inc"
// ui.frame() returns the attached frame count; ui.frame(i) copies frame i to the canvas.
static JSValue js_ui_frame(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    int i = -1;
    if (argc > 0 && JS_ToInt32(c, &i, argv[0])) return JS_EXCEPTION;
    if (i < 0 || i >= asset_count || !asset) return JS_NewInt32(c, asset_count);
    int64_t t0 = esp_timer_get_time();
    uint8_t *to = asset_bytes == FB_SIZE ? fb : fb2;
    bool got = false;
    if (frame_table) {
        uint32_t at = frame_table[i], len = frame_table[i + 1] - at;
        if (len <= 32768 && fseek(asset, asset_at + at, SEEK_SET) == 0 && fread(frame_packed, 1, len, asset) == len) {
            size_t in = len, out = asset_bytes; tinfl_init(frame_decoder);
            got = tinfl_decompress(frame_decoder, frame_packed, &in, to, to, &out, TINFL_FLAG_PARSE_ZLIB_HEADER | TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF) == TINFL_STATUS_DONE && out == (size_t)asset_bytes;
        }
    } else got = fseek(asset, asset_at + (uint32_t)i * asset_bytes, SEEK_SET) == 0 && fread(to, 1, asset_bytes, asset) == (size_t)asset_bytes;
    if (got && to == fb2)
        for (int n = 0; n < FB_SIZE / 2; n++) { unsigned b = fb2[n]; fb[n * 2] = ((b >> 6) * 5) << 4 | ((b >> 4 & 3) * 5); fb[n * 2 + 1] = ((b >> 2 & 3) * 5) << 4 | ((b & 3) * 5); }
    deadline += esp_timer_get_time() - t0;
    return JS_NewInt32(c, asset_count);
}
// ui.tick(ms) calls on_tick about every ms (at least 100); ui.tick(0) stops. The display gives back-pressure.
static JSValue js_ui_tick(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    int ms = 0;
    if (argc > 0 && JS_ToInt32(c, &ms, argv[0])) return JS_EXCEPTION;
    tick_ms = ms <= 0 ? 0 : ms < 100 ? 100 : ms; next_tick = mono_ms() + tick_ms;
    return JS_UNDEFINED;
}
#define NET_ALLOC(n) heap_caps_malloc(n, MALLOC_CAP_SPIRAM)
#define NET_FREE free
#include "js_net.inc"
static bool key_path(JSContext *c, JSValue v, char *path, size_t n) {
    JSCStringBuf buf; size_t len; const char *s = JS_ToCStringLen(c, &len, v, &buf);
    if (!s || len < 1 || len > 16) return false;
    for (size_t i = 0; i < len; i++) if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= '0' && s[i] <= '9') || s[i] == '_')) return false;
    snprintf(path, n, "/data/jsk_%s_%.*s", app_ns, (int)len, s); return true;
}
static pending_t *find_pending(const char *path) { for (int i = 0; i < npending; i++) if (!strcmp(pending[i].path, path)) return &pending[i]; return NULL; }
// Slow on SPIFFS (about 0.8 s per key), so it runs only after input has gone quiet.
static void flush_pending(void) {
    if (!npending) return;
    int64_t t0 = esp_timer_get_time(); int failed = 0, count = npending;
    for (int i = 0; i < npending; i++) {
        char tmp[48]; snprintf(tmp, sizeof tmp, "%.43s.t", pending[i].path);
        FILE *f = fopen(tmp, "wb"); bool ok = f != NULL;
        if (f) { ok = fwrite(pending[i].data, 1, pending[i].len, f) == pending[i].len; ok = fclose(f) == 0 && ok; }
        if (ok) { remove(pending[i].path); ok = rename(tmp, pending[i].path) == 0; }
        if (!ok) failed++;
        free(pending[i].data); pending[i].data = NULL;
    }
    npending = 0;
    printf("NOTE4 JS {\"store_flush_keys\":%d,\"failed\":%d,\"us\":%" PRId64 "}\n", count, failed, esp_timer_get_time() - t0);
}
// Finishes an interrupted atomic replace and totals this app's stored bytes.
static void scan_store(void) {
    char prefix[16]; int plen = snprintf(prefix, sizeof prefix, "jsk_%s_", app_ns);
    store_used = 0;
    DIR *d = opendir("/data"); if (!d) return;
    struct dirent *e; char path[64], base[64]; struct stat st;
    while ((e = readdir(d))) {
        if (strncmp(e->d_name, prefix, plen)) continue;
        snprintf(path, sizeof path, "/data/%.50s", e->d_name);
        size_t n = strlen(path);
        if (n > 2 && !strcmp(path + n - 2, ".t")) {
            snprintf(base, sizeof base, "%.*s", (int)(n - 2), path);
            if (stat(base, &st) == 0) { remove(path); continue; }
            if (rename(path, base)) continue;
            snprintf(path, sizeof path, "%.63s", base);
        }
        if (stat(path, &st) == 0) store_used += st.st_size;
    }
    closedir(d);
}
static JSValue js_store_get(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR; char path[44]; if (argc < 1 || !key_path(c, argv[0], path, sizeof path)) return JS_ThrowTypeError(c, "bad store key");
    pending_t *p = find_pending(path);
    if (p) return JS_NewStringLen(c, p->data, p->len);
    int64_t t0 = esp_timer_get_time();
    FILE *f = fopen(path, "rb"); if (!f) { deadline += esp_timer_get_time() - t0; return JS_NULL; }
    char *data = heap_caps_malloc(VALUE_MAX, MALLOC_CAP_SPIRAM); size_t n = data ? fread(data, 1, VALUE_MAX, f) : 0; fclose(f);
    deadline += esp_timer_get_time() - t0;
    if (!data) return JS_NULL;
    JSValue v = JS_NewStringLen(c, data, n); free(data); return v;
}
static JSValue js_store_set(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR; char path[44]; if (argc < 2 || !key_path(c, argv[0], path, sizeof path)) return JS_ThrowTypeError(c, "bad store key");
    JSCStringBuf buf; size_t len; const char *s = JS_ToCStringLen(c, &len, argv[1], &buf);
    if (!s) return JS_EXCEPTION;
    if (len > VALUE_MAX) return JS_ThrowTypeError(c, "store value too large");
    int64_t t0 = esp_timer_get_time();
    pending_t *p = find_pending(path); size_t old = 0; struct stat st;
    if (p) old = p->len; else if (stat(path, &st) == 0) old = st.st_size;
    if (store_used - old + len > STORE_QUOTA) { deadline += esp_timer_get_time() - t0; return JS_ThrowTypeError(c, "store quota exceeded"); }
    if (!p && npending == PENDING_MAX) flush_pending();
    char *copy = heap_caps_malloc(len ? len : 1, MALLOC_CAP_SPIRAM);
    if (!copy) { deadline += esp_timer_get_time() - t0; return JS_ThrowTypeError(c, "store out of memory"); }
    memcpy(copy, s, len);
    if (p) free(p->data); else { p = &pending[npending++]; snprintf(p->path, sizeof p->path, "%.43s", path); }
    p->data = copy; p->len = len; store_used = store_used - old + len; last_set_ms = mono_ms();
    deadline += esp_timer_get_time() - t0;
    return JS_UNDEFINED;
}
#include "note4_stdlib.h"

static void log_write(void *o, const void *b, size_t n) { fwrite(b, 1, n, stdout); }
static int interrupted(JSContext *c, void *o) { return esp_timer_get_time() > deadline; }
static void report_error(const char *where) {
    JSValue e = JS_GetException(ctx);
    printf("NOTE4 JS_ERROR %s: ", where); JS_PrintValueF(ctx, e, JS_DUMP_LONG); printf("\n");
}
static void call(const char *name, const char *arg) {
    JSValue g = JS_GetGlobalObject(ctx), f = JS_GetPropertyStr(ctx, g, name);
    if (JS_IsUndefined(f)) return;
    if (JS_StackCheck(ctx, 3)) { report_error(name); return; }
    int n = 0;
    if (arg) { JS_PushArg(ctx, JS_NewString(ctx, arg)); n = 1; }
    JS_PushArg(ctx, f); JS_PushArg(ctx, JS_NULL);
    int64_t t0 = esp_timer_get_time(); deadline = t0 + HANDLER_US;
    user_call = !strcmp(name, "on_key") || !strcmp(name, "on_start");
    JSValue r = JS_Call(ctx, n);
    user_call = false;
    int64_t us = esp_timer_get_time() - t0;
    bool failed = JS_IsException(r);
    if (!quiet || failed) printf("NOTE4 JS {\"call\":\"%s\",\"arg\":\"%s\",\"us\":%" PRId64 ",\"ok\":%s}\n", name, arg ? arg : "", us, failed ? "false" : "true");
    if (failed) report_error(name);
}
// Values are pushed before the function is looked up because a large body can trigger a compacting GC.
static void deliver_reply(void) {
    char key[17], *body = NULL; int status = 0; size_t len = 0;
    if (!n4_net_take(app_ns, key, &status, &body, &len)) return;
    JSValue g = JS_GetGlobalObject(ctx);
    if (JS_IsUndefined(JS_GetPropertyStr(ctx, g, "on_net")) || JS_StackCheck(ctx, 5)) { free(body); return; }
    JSValue text = JS_NewStringLen(ctx, body, len);
    free(body);
    if (JS_IsException(text)) { JS_GetException(ctx); text = JS_NewString(ctx, ""); status = -1; }
    JS_PushArg(ctx, text); JS_PushArg(ctx, JS_NewInt32(ctx, status)); JS_PushArg(ctx, JS_NewString(ctx, key));
    g = JS_GetGlobalObject(ctx);
    JS_PushArg(ctx, JS_GetPropertyStr(ctx, g, "on_net")); JS_PushArg(ctx, JS_NULL);
    int64_t t0 = esp_timer_get_time(); deadline = t0 + NET_HANDLER_US;
    JSValue r = JS_Call(ctx, 3);
    bool failed = JS_IsException(r);
    printf("NOTE4 JS {\"call\":\"on_net\",\"key\":\"%s\",\"status\":%d,\"bytes\":%u,\"us\":%" PRId64 ",\"ok\":%s}\n", key, status, (unsigned)len, esp_timer_get_time() - t0, failed ? "false" : "true");
    if (failed) report_error("on_net");
}
static bool start_source(const char *src, size_t len, const char *ns, int mode) {
    js_app_stop();
    if (!mem) mem = heap_caps_malloc(JS_HEAP_SIZE, MALLOC_CAP_SPIRAM);
    if (!fb) fb = heap_caps_malloc(FB_SIZE, MALLOC_CAP_SPIRAM);
    if (!fb2) fb2 = heap_caps_malloc(FB_SIZE / 2, MALLOC_CAP_SPIRAM);
    if (!mem || !fb || !fb2) return false;
    asset_count = next_count; asset_bytes = next_bytes; asset_at = next_asset_at; tick_ms = 0; next_count = 0;
    if (asset_count) {
        asset = fopen(asset_path, "rb");
        if (asset && next_deflated) {
            size_t table = (asset_count + 1) * 4;
            frame_table = heap_caps_malloc(table, MALLOC_CAP_SPIRAM); frame_packed = heap_caps_malloc(32768, MALLOC_CAP_SPIRAM); frame_decoder = heap_caps_malloc(sizeof(tinfl_decompressor), MALLOC_CAP_SPIRAM);
            if (!frame_table || !frame_packed || !frame_decoder || fseek(asset, asset_at, SEEK_SET) || fread(frame_table, 1, table, asset) != table) { fclose(asset); asset = NULL; }
        }
        if (!asset) asset_count = 0;
    }
    memset(fb, 0xff, FB_SIZE); dirty = false; force_clear = false; fast_count = 0; waiting_refresh = false; injected[0] = 0;
    snprintf(app_ns, sizeof app_ns, "%s", ns); refresh_mode = mode; dots_mode = mode == N4_DOTS; n4_display_tune(mode != N4_GRAY, mode == N4_TUNED);
    n4_net_app(app_ns);
    scan_store();
    int64_t t0 = esp_timer_get_time();
    ctx = JS_NewContext(mem, JS_HEAP_SIZE, &js_stdlib);
    if (!ctx) return false;
    JS_SetLogFunc(ctx, log_write);
    JS_SetInterruptHandler(ctx, interrupted);
    deadline = t0 + START_US;
    JSValue v = JS_Eval(ctx, src, len, "app.js", 0);
    int64_t us = esp_timer_get_time() - t0;
    printf("NOTE4 JS {\"call\":\"compile_and_load\",\"app\":\"%s\",\"source_bytes\":%u,\"store_used\":%u,\"fast\":%s,\"us\":%" PRId64 ",\"ok\":%s}\n", app_ns, (unsigned)len, (unsigned)store_used, mode != N4_CLEAR ? "true" : "false", us, JS_IsException(v) ? "false" : "true");
    if (JS_IsException(v)) { report_error("load"); js_app_stop(); return false; }
    call("on_start", NULL);
    JS_GC(ctx); JS_DumpMemory(ctx, 0); printf("\n");
    return true;
}
bool js_app_start(int mode) { return start_source(app_start, (size_t)(app_end - app_start) - 1, "probe000", mode); }
bool js_app_active(void) { return ctx != NULL; }
bool js_app_load_file(const char *path, uint32_t offset, uint32_t size, const char *app_id, int mode, int frames, int frame_bytes, bool deflated) {
    if (!size || size > 65536) return false;
    char *src = heap_caps_malloc(size + 1, MALLOC_CAP_SPIRAM);
    if (!src) return false;
    FILE *f = fopen(path, "rb");
    bool ok = f && fseek(f, offset, SEEK_SET) == 0 && fread(src, 1, size, f) == size;
    if (f) fclose(f);
    if (ok) { src[size] = 0; next_count = frames; next_bytes = frame_bytes; next_deflated = deflated; next_asset_at = offset + size; snprintf(asset_path, sizeof asset_path, "%s", path); ok = start_source(src, size, app_id, mode); }
    free(src);
    return ok;
}
void js_app_stop(void) { flush_pending(); tick_ms = 0; if (asset) { fclose(asset); asset = NULL; } free(frame_table); free(frame_packed); free(frame_decoder); frame_table = NULL; frame_packed = NULL; frame_decoder = NULL; if (ctx) { JS_FreeContext(ctx); ctx = NULL; n4_net_app(""); printf("NOTE4 JS {\"call\":\"closed\"}\n"); } }
void js_app_inject(const char *key) { snprintf(injected, sizeof injected, "%s", key); }
void js_app_tick(uint32_t bits) {
    if (!ctx) return;
    if (bits & 2) call("on_key", "up");
    if (bits & 4) call("on_key", "down");
    if (bits & (1 | 64)) call("on_key", "ok");
    // Only the wave gesture is exposed; approach and retreat (16, 32) are deliberately dropped.
    if (bits & 8) call("on_key", "wave");
    if (injected[0]) { char k[16]; snprintf(k, sizeof k, "%s", injected); injected[0] = 0; printf("NOTE4 JS {\"injected\":\"%s\"}\n", k); call("on_key", k); }
    deliver_reply();
    if (!ctx) return;
    int64_t now = mono_ms();
    bool busy = n4_display_busy();
    if (busy) last_busy = now;
    if (tick_ms && !dirty && now >= next_tick) { next_tick = now + tick_ms; quiet = true; call("on_tick", NULL); quiet = false; if (!ctx) return; }
    if (waiting_refresh && last_busy >= present_at && now - last_busy > 400) { waiting_refresh = false; printf("NOTE4 JS {\"settle_ms\":%" PRId64 "}\n", last_busy - present_at); }
    if (dirty) {
        if (force_clear || refresh_mode == N4_CLEAR) {
            if (!busy && n4_display_card(fb, FB_SIZE)) { dirty = false; force_clear = false; fast_count = 0; printf("NOTE4 JS {\"full_refresh\":true}\n"); waiting_refresh = true; present_at = now; }
        } else if (!(((fast_count >= FULL_REFRESH_EVERY && (!tick_ms || tick_ms >= 1000)) || refresh_mode == N4_FLASH) && busy)) {
            // Same 4bpp-to-2bpp mapping as the native runner, then the partial-refresh path.
            for (int i = 0; i < FB_SIZE / 2; i++) { unsigned out = 0; for (int k = 0; k < 4; k++) { int p = i * 4 + k; unsigned g = (p & 1) ? fb[p / 2] & 15 : fb[p / 2] >> 4; out |= ((g + 2) / 5) << (6 - 2 * k); } fb2[i] = out; }
            bool rebase = (fast_count >= FULL_REFRESH_EVERY && (!tick_ms || tick_ms >= 1000)) || refresh_mode == N4_FLASH;
            if (rebase) { n4_display_rebase(); printf("NOTE4 JS {\"rebase\":true}\n"); }
            if (n4_display_frame(fb2, FB_SIZE / 2)) { dirty = false; fast_count = rebase ? 0 : fast_count + 1; waiting_refresh = true; present_at = now; }
        }
    }
    if (npending && !busy && now - last_set_ms > FLUSH_DELAY_MS) flush_pending();
}
