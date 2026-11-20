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
static uint8_t mem[JS_HEAP_SIZE], fb[FB_SIZE], glass_tmp[120000];
static const uint8_t *font_start;
static const uint8_t *aa_font_start;
static volatile bool dirty;
static bool force_clear;
static int refresh_mode = 0;
static int active_font = 0;
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

// Lightweight Z-order, Box-Overflow, White-Bar Occlusion & Contrast Finish Gate (WASM-only, 0B firmware cost)
typedef struct { int x, y, w, h, g, kind, z; } fg_shape_t;
typedef struct { int x1, y1, x2, y2, ax1, ay1, ax2, ay2, fg, z, ink_px, low_px; } fg_text_t;
typedef struct { int code, x, y, detail; } fg_issue_t;
static fg_shape_t l_shapes[128];
static fg_text_t l_texts[96];
static fg_issue_t l_issues[24];
static int l_nshape, l_ntext, l_nissue, l_seq;
static int l_minx = 400, l_miny = 300, l_maxx = -1, l_maxy = -1;
static int l_cur_ax1, l_cur_ay1, l_cur_ax2, l_cur_ay2, l_cur_fg, l_cur_ink, l_cur_low;
static int l_analyzed;

static void layout_reset(void) {
    l_nshape = 0; l_ntext = 0; l_nissue = 0; l_seq = 0; l_analyzed = 0;
    l_minx = 400; l_miny = 300; l_maxx = -1; l_maxy = -1;
}
static void layout_add_shape(int x, int y, int w, int h, int g, int kind) {
    l_analyzed = 0;
    if (w <= 0 || h <= 0) return;
    if (kind == 0 && w >= 390 && h >= 290 && x <= 4 && y <= 4) { layout_reset(); return; }
    if (l_nshape < 128) l_shapes[l_nshape++] = (fg_shape_t){x, y, w, h, g, kind, ++l_seq};
}
static void layout_text_begin(int fg) {
    l_analyzed = 0;
    l_cur_ax1 = 400; l_cur_ay1 = 300; l_cur_ax2 = -1; l_cur_ay2 = -1;
    l_cur_fg = fg; l_cur_ink = 0; l_cur_low = 0;
}
static void layout_text_px(int x, int y, int bg, int fg) {
    if (x < l_cur_ax1) l_cur_ax1 = x;
    if (y < l_cur_ay1) l_cur_ay1 = y;
    if (x > l_cur_ax2) l_cur_ax2 = x;
    if (y > l_cur_ay2) l_cur_ay2 = y;
    l_cur_ink++;
    int diff = bg - fg; if (diff < 0) diff = -diff;
    if (diff < 4) l_cur_low++;
}
static void layout_text_end(int x1, int y1, int x2, int y2) {
    int ax1 = l_cur_ax2 >= l_cur_ax1 ? l_cur_ax1 : x1;
    int ay1 = l_cur_ay2 >= l_cur_ay1 ? l_cur_ay1 : y1;
    int ax2 = l_cur_ax2 >= l_cur_ax1 ? l_cur_ax2 + 1 : x2;
    int ay2 = l_cur_ay2 >= l_cur_ay1 ? l_cur_ay2 + 1 : y2;
    if (ax1 < l_minx) l_minx = ax1;
    if (ay1 < l_miny) l_miny = ay1;
    if (ax2 > l_maxx) l_maxx = ax2;
    if (ay2 > l_maxy) l_maxy = ay2;
    if (l_ntext < 96) {
        l_texts[l_ntext++] = (fg_text_t){x1, y1, x2, y2, ax1, ay1, ax2, ay2, l_cur_fg, ++l_seq, l_cur_ink, l_cur_low};
    }
}
static void add_issue(int code, int x, int y, int detail) {
    if (l_nissue < 24) l_issues[l_nissue++] = (fg_issue_t){code, x, y, detail};
}
static int rect_inter(int ax1, int ay1, int ax2, int ay2, int bx1, int by1, int bx2, int by2, int *ow, int *oh) {
    int ix1 = ax1 > bx1 ? ax1 : bx1, iy1 = ay1 > by1 ? ay1 : by1;
    int ix2 = ax2 < bx2 ? ax2 : bx2, iy2 = ay2 < by2 ? ay2 : by2;
    if (ix2 <= ix1 || iy2 <= iy1) { if (ow) *ow = 0; if (oh) *oh = 0; return 0; }
    if (ow) *ow = ix2 - ix1;
    if (oh) *oh = iy2 - iy1;
    return (ix2 - ix1) * (iy2 - iy1);
}
static int shape_has_label_after(const fg_shape_t *s) {
    for (int j = 0; j < l_ntext; j++) {
        const fg_text_t *t = &l_texts[j];
        if (t->z <= s->z) continue;
        int cx = (t->ax1 + t->ax2) / 2, cy = (t->ay1 + t->ay2) / 2;
        if (cx >= s->x && cx <= s->x + s->w && cy >= s->y && cy <= s->y + s->h) return 1;
    }
    return 0;
}
static int opaque_covers_between(const fg_text_t *t, int z_lo, int z_hi) {
    for (int i = 0; i < l_nshape; i++) {
        const fg_shape_t *s = &l_shapes[i];
        if (s->z <= z_lo || s->z >= z_hi) continue;
        if ((s->kind == 0 || s->kind == 4) && s->x <= t->ax1 && s->y <= t->ay1 && s->x + s->w >= t->ax2 && s->y + s->h >= t->ay2) return 1;
    }
    return 0;
}
static void layout_analyze(void) {
    if (l_analyzed) return;
    l_analyzed = 1;
    l_nissue = 0;
    if (l_ntext == 0) return;

    // 1. Outer physical bezel clearance
    int min_edge = l_minx;
    if (l_miny < min_edge) min_edge = l_miny;
    if (400 - l_maxx < min_edge) min_edge = 400 - l_maxx;
    if (300 - l_maxy < min_edge) min_edge = 300 - l_maxy;
    if (min_edge < 10) add_issue(8, l_minx, l_miny, min_edge);

    // 2. Per-text container overflow, tight border padding, low contrast, and divider/bar collision
    for (int i = 0; i < l_ntext; i++) {
        const fg_text_t *t = &l_texts[i];
        int tw = t->ax2 - t->ax1, th = t->ay2 - t->ay1;
        if (tw <= 0 || th <= 0) continue;

        // 2a. Low contrast against actual pixels behind text (catches white text on white bar / dark on dark!)
        if (t->ink_px >= 20 && t->low_px * 100 >= t->ink_px * 25) {
            add_issue(7, t->ax1, t->ay1, (t->low_px * 100) / t->ink_px);
        }

        // 2b. Container box drawn BEFORE this text: catch BOTH inside-overflow AND border-straddling!
        int best_c = -1, best_area = 1 << 30;
        int straddle_over = 0, straddle_side = 0;
        for (int j = 0; j < l_nshape; j++) {
            const fg_shape_t *s = &l_shapes[j];
            if (s->z >= t->z) continue;
            if (s->kind != 0 && s->kind != 1 && s->kind != 4) continue;
            if (s->w < 36 || s->h < 20 || (s->w >= 390 && s->h >= 290)) continue;
            int ow = 0, oh = 0;
            int area_inter = rect_inter(t->ax1, t->ay1, t->ax2, t->ay2, s->x, s->y, s->x + s->w, s->y + s->h, &ow, &oh);
            if (!area_inter) continue;
            int fully_in = (t->ax1 >= s->x && t->ax2 <= s->x + s->w && t->ay1 >= s->y && t->ay2 <= s->y + s->h);
            int start_in = (t->ax1 >= s->x && t->ax1 < s->x + s->w && (t->ay1 + t->ay2) / 2 >= s->y && (t->ay1 + t->ay2) / 2 < s->y + s->h);
            if (!fully_in && !start_in && area_inter * 100 < tw * th * 40) {
                // Text straddles the outer border of a card/glass/button box (e.g. footer overlapping card bottom rim!)
                if (ow >= 6 && oh >= 2) {
                    int ov = oh < ow ? oh : ow;
                    if (ov > straddle_over) {
                        straddle_over = ov;
                        straddle_side = (oh <= ow) ? (t->ay1 < s->y ? 3 : 4) : (t->ax1 < s->x ? 1 : 2);
                    }
                }
                continue;
            }
            int area = s->w * s->h;
            if (area < best_area) { best_area = area; best_c = j; }
        }
        if (straddle_over > 0 && best_c < 0) {
            add_issue(1, t->ax1, t->ay1, (straddle_side << 12) | (straddle_over & 0xfff));
        }
        if (best_c >= 0) {
            const fg_shape_t *s = &l_shapes[best_c];
            int lg = t->ax1 - s->x, rg = (s->x + s->w) - t->ax2;
            int tg = t->ay1 - s->y, bg = (s->y + s->h) - t->ay2;
            int over = 0, oside = 0;
            if (lg < 0 && -lg > over) { over = -lg; oside = 1; }
            if (rg < 0 && -rg > over) { over = -rg; oside = 2; }
            if (tg < 0 && -tg > over) { over = -tg; oside = 3; }
            if (bg < 0 && -bg > over) { over = -bg; oside = 4; }
            if (over > 0) {
                add_issue(1, t->ax1, t->ay1, (oside << 12) | (over & 0xfff));
            } else {
                int hmin = s->h >= 44 ? 8 : 4;
                int vmin = s->h >= 44 ? 4 : 1;
                int worst = 999, wside = 0;
                if (lg < hmin && lg < worst) { worst = lg; wside = 1; }
                if (rg < hmin && rg < worst) { worst = rg; wside = 2; }
                if (tg < vmin && tg < worst) { worst = tg; wside = 3; }
                if (bg < vmin && bg < worst) { worst = bg; wside = 4; }
                if (worst < 999) add_issue(2, t->ax1, t->ay1, (wside << 12) | (worst & 0xfff));
            }
        }

        // 2c. Text drawn ON TOP of or touching a thin bar / divider line / progress bar (drawn BEFORE text)
        for (int j = 0; j < l_nshape; j++) {
            const fg_shape_t *s = &l_shapes[j];
            if (s->z >= t->z) continue;
            int is_bar = (s->kind == 2 && (s->w >= 14 || s->h >= 14)) || (s->kind == 0 && s->h >= 4 && s->h <= 16 && s->w >= 24);
            if (!is_bar) continue;
            int pad_y = (s->kind == 2 && s->h <= 3) ? 1 : 0;
            int ow = 0, oh = 0;
            if (rect_inter(t->ax1, t->ay1, t->ax2, t->ay2, s->x, s->y - pad_y, s->x + s->w, s->y + s->h + pad_y, &ow, &oh)) {
                if ((s->kind == 2 && (ow >= 3 || oh >= 3)) || (ow >= 6 && oh >= 3)) {
                    add_issue(6, t->ax1, t->ay1, s->y);
                    break;
                }
            }
        }

        // 2d. Z-order check: shape/bar/button drawn AFTER this text that occludes/erases/clips it!
        for (int j = 0; j < l_nshape; j++) {
            const fg_shape_t *s = &l_shapes[j];
            if (s->z <= t->z) continue;
            if (s->kind == 1) continue; // stroke drawn around text is fine unless it hits pixels (handled below)
            // Allowed Exception A: intentional 1-2px horizontal strikethrough line on completed item
            if (s->kind == 2 && s->h <= 2 && s->w >= 12 && s->y >= t->ay1 + 2 && s->y <= t->ay2 - 2) continue;
            int ow = 0, oh = 0;
            int inter = rect_inter(t->ax1, t->ay1, t->ax2, t->ay2, s->x, s->y, s->x + s->w, s->y + s->h, &ow, &oh);
            if (!inter || (ow < 3 && oh < 3)) continue;
            int has_own_label = (s->kind == 0 || s->kind == 4) && s->w >= 44 && s->h >= 22 && shape_has_label_after(s);
            if (has_own_label) {
                // Intentional foreground modal/button covering background cleanly vs partially slicing adjacent text!
                int full_cover = (s->x <= t->ax1 && s->y <= t->ay1 && s->x + s->w >= t->ax2 && s->y + s->h >= t->ay2);
                if (!full_cover) add_issue(4, s->x, s->y, t->ay1);
            } else {
                // Accidental white bar / rect / circle / bar drawn AFTER text, occluding/erasing text!
                add_issue(3, s->x, s->y, t->ay1);
            }
            break;
        }
    }

    // 3. Text-on-Text overlap (excluding pairs where an opaque modal/card cleared T1 in between)
    for (int i = 0; i < l_ntext; i++) {
        for (int j = i + 1; j < l_ntext; j++) {
            int ow = 0, oh = 0;
            if (rect_inter(l_texts[i].ax1, l_texts[i].ay1, l_texts[i].ax2, l_texts[i].ay2,
                           l_texts[j].ax1, l_texts[j].ay1, l_texts[j].ax2, l_texts[j].ay2, &ow, &oh)) {
                if (ow >= 3 && oh >= 3 && !opaque_covers_between(&l_texts[i], l_texts[i].z, l_texts[j].z)) {
                    add_issue(5, l_texts[j].ax1, l_texts[j].ay1, ow);
                }
            }
        }
    }
}
#define JS_UI_LAYOUT_RESET() layout_reset()
#define JS_UI_SHAPE(x, y, w, h, g, kind) layout_add_shape((x), (y), (w), (h), (g), (kind))
#define JS_UI_TEXT_BEGIN(g) layout_text_begin((g))
#define JS_UI_TEXT_PX(x, y, bg, fg) layout_text_px((x), (y), (bg), (fg))
#define JS_UI_TEXT_END(x0, y0, x1, y1) layout_text_end((x0), (y0), (x1), (y1))

static bool dots_mode;
#include "js_ui.inc"
EMSCRIPTEN_KEEPALIVE int vm_layout(int which) {
    layout_analyze();
    switch (which) {
        case 0: return l_minx; case 1: return l_miny;
        case 2: return l_maxx; case 3: return l_maxy;
        case 4: return l_nissue;
        default: return 0;
    }
}
EMSCRIPTEN_KEEPALIVE int vm_issue(int idx, int field) {
    layout_analyze();
    if (idx < 0 || idx >= l_nissue) return 0;
    switch (field) {
        case 0: return l_issues[idx].code;
        case 1: return l_issues[idx].x;
        case 2: return l_issues[idx].y;
        case 3: return l_issues[idx].detail;
        default: return 0;
    }
}
EMSCRIPTEN_KEEPALIVE void vm_fast(int on) { dots_mode = on; refresh_mode = on ? 0 : 4; }
EMSCRIPTEN_KEEPALIVE void vm_mode(int mode) { refresh_mode = mode; dots_mode = (mode == 0); }
EMSCRIPTEN_KEEPALIVE void vm_set_aa_font(const uint8_t *p) { aa_font_start = p; }
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
    memset(fb, 0xff, FB_SIZE); dirty = false; force_clear = false; ticks = 0; tick_ms = 0; active_font = 0; layout_reset();
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
