// Browser and server build of the device JS host: same engine, same stdlib, same drawing code.
// Differences from the device are confined to storage (in memory) and the time budget (counted).
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <sys/time.h>
#include <emscripten/emscripten.h>
#include "cutils.h"
#include "mquickjs.h"

#define FB_SIZE 60000
#define JS_HEAP_SIZE (512 * 1024)
#define VALUE_MAX 4096
#define STORE_QUOTA (256 * 1024)
#define STORE_MAX 256
#define LOG_MAX 16384

static JSContext *ctx;
static uint8_t mem[JS_HEAP_SIZE], fb[FB_SIZE];
static const uint8_t *font_start;
static volatile bool dirty;
static bool force_clear;
static uint32_t ticks, tick_limit = 1u << 30;
static char logbuf[LOG_MAX];
static int loglen;
typedef struct { char key[17]; char *data; size_t len; } entry_t;
static entry_t store[STORE_MAX];
static int nstore;
static size_t store_used;

#include "mqjs_host_funcs.inc"
static int oob_count, oob_x, oob_y;
#define JS_UI_OOB(a, b) (oob_count++, oob_x = (a), oob_y = (b))
static bool dots_mode;
#include "js_ui.inc"
EMSCRIPTEN_KEEPALIVE void vm_fast(int on) { dots_mode = on; }
__attribute__((import_module("env"), import_name("n4_frame"))) extern void n4_frame(int i, uint8_t *to);
static int asset_count, tick_ms;
EMSCRIPTEN_KEEPALIVE void vm_frames(int n) { asset_count = n; }
EMSCRIPTEN_KEEPALIVE int vm_tick_ms(void) { return tick_ms; }
static JSValue js_ui_frame(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR; int i = -1;
    if (argc > 0 && JS_ToInt32(c, &i, argv[0])) return JS_EXCEPTION;
    if (i >= 0 && i < asset_count) n4_frame(i, fb);
    return JS_NewInt32(c, asset_count);
}
static JSValue js_ui_tick(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR; int ms = 0;
    if (argc > 0 && JS_ToInt32(c, &ms, argv[0])) return JS_EXCEPTION;
    tick_ms = ms <= 0 ? 0 : ms < 100 ? 100 : ms; return JS_UNDEFINED;
}
__attribute__((import_module("env"), import_name("n4_net"))) extern int n4_net(const char *key, const char *url, const char *method, const char *headers, const char *body, int body_len, int keep);
static const char app_ns[] = "preview";
static bool user_call;
static bool n4_net_enqueue(const char *app, const char *key, const char *url, const char *method, const char *headers, const char *body, size_t body_len, bool keep, bool user) { return n4_net(key, url, method, headers, body, body_len, keep); }
#define NET_ALLOC malloc
#define NET_FREE free
#include "js_net.inc"
EMSCRIPTEN_KEEPALIVE int vm_oob(void) { return oob_count; }
EMSCRIPTEN_KEEPALIVE int vm_oob_x(void) { return oob_x; }
EMSCRIPTEN_KEEPALIVE int vm_oob_y(void) { return oob_y; }
EMSCRIPTEN_KEEPALIVE void vm_oob_clear(void) { oob_count = 0; }

static entry_t *store_find(const char *k) { for (int i = 0; i < nstore; i++) if (!strcmp(store[i].key, k)) return &store[i]; return NULL; }
static bool valid_key(JSContext *c, JSValue v, char *out) {
    JSCStringBuf buf; size_t len; const char *s = JS_ToCStringLen(c, &len, v, &buf);
    if (!s || len < 1 || len > 16) return false;
    for (size_t i = 0; i < len; i++) if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= '0' && s[i] <= '9') || s[i] == '_')) return false;
    memcpy(out, s, len); out[len] = 0; return true;
}
static JSValue js_store_get(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR; char k[17]; if (argc < 1 || !valid_key(c, argv[0], k)) return JS_ThrowTypeError(c, "bad store key");
    entry_t *e = store_find(k); return e ? JS_NewStringLen(c, e->data, e->len) : JS_NULL;
}
static JSValue js_store_set(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR; char k[17]; if (argc < 2 || !valid_key(c, argv[0], k)) return JS_ThrowTypeError(c, "bad store key");
    JSCStringBuf buf; size_t len; const char *s = JS_ToCStringLen(c, &len, argv[1], &buf);
    if (!s) return JS_EXCEPTION;
    if (len > VALUE_MAX) return JS_ThrowTypeError(c, "store value too large");
    entry_t *e = store_find(k); size_t old = e ? e->len : 0;
    if (store_used - old + len > STORE_QUOTA) return JS_ThrowTypeError(c, "store quota exceeded");
    if (!e) { if (nstore == STORE_MAX) return JS_ThrowTypeError(c, "store too many keys"); e = &store[nstore++]; strcpy(e->key, k); e->data = NULL; }
    free(e->data); e->data = malloc(len ? len : 1); memcpy(e->data, s, len); e->len = len; store_used = store_used - old + len;
    return JS_UNDEFINED;
}
#include "note4_stdlib.h"

static void log_write(void *o, const void *b, size_t n) { if (loglen + n >= LOG_MAX) n = LOG_MAX - loglen - 1; memcpy(logbuf + loglen, b, n); loglen += n; logbuf[loglen] = 0; }
static int interrupted(JSContext *c, void *o) { return ++ticks > tick_limit; }
static void report_error(void) { JSValue e = JS_GetException(ctx); JS_PrintValueF(ctx, e, JS_DUMP_LONG); log_write(NULL, "\n", 1); }

EMSCRIPTEN_KEEPALIVE uint8_t *vm_alloc(size_t n) { return malloc(n); }
EMSCRIPTEN_KEEPALIVE void vm_free(void *p) { free(p); }
EMSCRIPTEN_KEEPALIVE void vm_set_font(const uint8_t *p) { font_start = p; setvbuf(stdout, NULL, _IONBF, 0); }
EMSCRIPTEN_KEEPALIVE void vm_set_tick_limit(uint32_t n) { tick_limit = n; }
EMSCRIPTEN_KEEPALIVE uint8_t *vm_frame(void) { return fb; }
EMSCRIPTEN_KEEPALIVE char *vm_log(void) { return logbuf; }
EMSCRIPTEN_KEEPALIVE int vm_log_len(void) { return loglen; }
EMSCRIPTEN_KEEPALIVE void vm_log_clear(void) { loglen = 0; logbuf[0] = 0; }
EMSCRIPTEN_KEEPALIVE uint32_t vm_ticks(void) { return ticks; }
EMSCRIPTEN_KEEPALIVE int vm_take_dirty(void) { int d = dirty; dirty = false; return d; }
EMSCRIPTEN_KEEPALIVE int vm_take_clear(void) { int d = force_clear; force_clear = false; return d; }
EMSCRIPTEN_KEEPALIVE uint32_t vm_store_used(void) { return store_used; }
EMSCRIPTEN_KEEPALIVE int vm_store_count(void) { return nstore; }
EMSCRIPTEN_KEEPALIVE const char *vm_store_key(int i) { return store[i].key; }
EMSCRIPTEN_KEEPALIVE const char *vm_store_value(int i) { return store[i].data; }
EMSCRIPTEN_KEEPALIVE int vm_store_value_len(int i) { return store[i].len; }
EMSCRIPTEN_KEEPALIVE void vm_store_clear(void) { for (int i = 0; i < nstore; i++) free(store[i].data); nstore = 0; store_used = 0; }
EMSCRIPTEN_KEEPALIVE void vm_store_put(const char *k, const char *v, size_t n) { if (nstore == STORE_MAX) return; entry_t *e = &store[nstore++]; snprintf(e->key, sizeof e->key, "%s", k); e->data = malloc(n ? n : 1); memcpy(e->data, v, n); e->len = n; store_used += n; }

static int call(const char *name, const char *arg) {
    JSValue g = JS_GetGlobalObject(ctx), f = JS_GetPropertyStr(ctx, g, name);
    if (JS_IsUndefined(f)) return 0;
    if (JS_StackCheck(ctx, 3)) { report_error(); return -1; }
    int n = 0;
    if (arg) { JS_PushArg(ctx, JS_NewString(ctx, arg)); n = 1; }
    JS_PushArg(ctx, f); JS_PushArg(ctx, JS_NULL);
    ticks = 0;
    JSValue r = JS_Call(ctx, n);
    if (JS_IsException(r)) { report_error(); return -1; }
    return 0;
}
// Returns 0 on success, -1 when the source failed to compile or load, -2 when on_start threw.
EMSCRIPTEN_KEEPALIVE int vm_start(const char *src, size_t len) {
    if (ctx) { JS_FreeContext(ctx); ctx = NULL; }
    memset(fb, 0xff, FB_SIZE); dirty = false; force_clear = false; ticks = 0; tick_ms = 0;
    ctx = JS_NewContext(mem, JS_HEAP_SIZE, &js_stdlib);
    if (!ctx) return -1;
    JS_SetLogFunc(ctx, log_write);
    JS_SetInterruptHandler(ctx, interrupted);
    JSValue v = JS_Eval(ctx, src, len, "app.js", 0);
    if (JS_IsException(v)) { report_error(); return -1; }
    return call("on_start", NULL) ? -2 : 0;
}
EMSCRIPTEN_KEEPALIVE int vm_key(const char *k) { return ctx ? call("on_key", k) : -1; }
EMSCRIPTEN_KEEPALIVE int vm_net(const char *key, int status, const char *body, size_t len) {
    if (!ctx) return -1;
    JSValue g = JS_GetGlobalObject(ctx);
    if (JS_IsUndefined(JS_GetPropertyStr(ctx, g, "on_net"))) return 0;
    if (JS_StackCheck(ctx, 5)) { report_error(); return -1; }
    JS_PushArg(ctx, JS_NewStringLen(ctx, body, len)); JS_PushArg(ctx, JS_NewInt32(ctx, status)); JS_PushArg(ctx, JS_NewString(ctx, key));
    g = JS_GetGlobalObject(ctx);
    JS_PushArg(ctx, JS_GetPropertyStr(ctx, g, "on_net")); JS_PushArg(ctx, JS_NULL);
    ticks = 0;
    JSValue r = JS_Call(ctx, 3);
    if (JS_IsException(r)) { report_error(); return -1; }
    return 0;
}
EMSCRIPTEN_KEEPALIVE int vm_tick(void) { return ctx ? call("on_tick", NULL) : -1; }
