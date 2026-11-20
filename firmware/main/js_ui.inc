// Drawing API shared verbatim by the device host (js_app.c) and the WASM preview (wasm/note4_vm.c).
// Expects: ctx, fb, font_start, dirty, force_clear.
#ifndef JS_UI_OOB
#define JS_UI_OOB(a, b) ((void)0)
#endif
static int arg_int(JSValue *argv, int argc, int i, int fallback) { int v; if (i >= argc || JS_ToInt32(ctx, &v, argv[i])) return fallback; return v; }
static inline void px(int x, int y, int g) {
    if (x < 0 || y < 0 || x >= 400 || y >= 300) { JS_UI_OOB(x, y); return; }
    int i = y * 400 + x;
    if (i & 1) fb[i / 2] = (fb[i / 2] & 0xf0) | g; else fb[i / 2] = (fb[i / 2] & 0x0f) | (g << 4);
}
// Dot mode drives only black and white, because a mid-gray lands differently depending on the pixel's past.
// Fills become an ordered dot pattern; text stays solid so thin strokes remain readable.
static inline int ink(int x, int y, int g) {
    static const uint8_t bayer[4][4] = {{0, 8, 2, 10}, {12, 4, 14, 6}, {3, 11, 1, 9}, {15, 7, 13, 5}};
    return !dots_mode || !g || g == 15 ? g : g > bayer[y & 3][x & 3] ? 15 : 0;
}
static const uint8_t *glyph(uint32_t c) {
    static const uint32_t r[4][2] = {{32, 127}, {12288, 12352}, {19968, 40960}, {65280, 65376}};
    uint32_t off = 0;
    for (int i = 0; i < 4; i++) { if (c >= r[i][0] && c < r[i][1]) return font_start + (off + c - r[i][0]) * 32; off += r[i][1] - r[i][0]; }
    return NULL;
}
static JSValue js_ui_clear(JSContext *c, JSValue *t, int argc, JSValue *argv) { argc &= ~FRAME_CF_CTOR; int g = arg_int(argv, argc, 0, 15) & 15; if (!dots_mode || !g || g == 15) memset(fb, g * 0x11, FB_SIZE); else for (int y = 0; y < 300; y++) for (int x = 0; x < 400; x++) px(x, y, ink(x, y, g)); return JS_UNDEFINED; }
static JSValue js_ui_rect(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR; int x = arg_int(argv, argc, 0, 0), y = arg_int(argv, argc, 1, 0), w = arg_int(argv, argc, 2, 0), h = arg_int(argv, argc, 3, 0), g = arg_int(argv, argc, 4, 0) & 15;
    if (w <= 0 || h <= 0) return JS_UNDEFINED;
    if (w > 400) w = 400; if (h > 300) h = 300; // keep x+w / y+h inside int32 before the OOB check below
    if (x < 0 || y < 0 || x + w > 400 || y + h > 300) JS_UI_OOB(x < 0 ? x : x + w, y < 0 ? y : y + h);
    for (int yy = y; yy < y + h && yy < 300; yy++) for (int xx = x; xx < x + w && xx < 400; xx++) px(xx, yy, ink(xx, yy, g));
    return JS_UNDEFINED;
}
// ui.text(x, y, string, scale=1, gray=0, maxWidth=400-x) returns the next line's y.
static JSValue js_ui_text(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR; int x0 = arg_int(argv, argc, 0, 0), y = arg_int(argv, argc, 1, 0);
    if (argc < 3) return JS_ThrowTypeError(c, "ui.text needs x,y,string");
    int scale = arg_int(argv, argc, 3, 1), g = arg_int(argv, argc, 4, 0) & 15, maxw = arg_int(argv, argc, 5, 400 - x0);
    if (dots_mode) g = g < 11 ? 0 : 15;
    if (scale < 1 || scale > 4) return JS_ThrowTypeError(c, "ui.text scale must be 1..4");
    JSCStringBuf buf; size_t len; const char *s = JS_ToCStringLen(c, &len, argv[2], &buf);
    if (!s) return JS_EXCEPTION;
    int x = x0;
    for (size_t i = 0; i < len;) {
        uint8_t b = (uint8_t)s[i]; uint32_t cp = b; int n = 1;
        if (b >= 0xf0) { cp = b & 7; n = 4; } else if (b >= 0xe0) { cp = b & 15; n = 3; } else if (b >= 0xc0) { cp = b & 31; n = 2; }
        for (int k = 1; k < n && i + k < len; k++) cp = (cp << 6) | ((uint8_t)s[i + k] & 63);
        i += n;
        int adv = (cp < 128 ? 9 : 16) * scale;
        if (cp == '\n' || x + adv > x0 + maxw) { x = x0; y += 22 * scale; if (cp == '\n') continue; }
        const uint8_t *m = glyph(cp);
        if (m) for (int yy = 0; yy < 16; yy++) for (int xx = 0; xx < 16; xx++) if (m[yy * 2 + (xx >> 3)] & (128 >> (xx & 7)))
            for (int a = 0; a < scale; a++) for (int d = 0; d < scale; d++) px(x + xx * scale + d, y + yy * scale + a, g);
        x += adv;
    }
    return JS_NewInt32(c, y + 22 * scale);
}
// ui.present() uses the app's refresh mode; ui.present('clear') forces one 16-gray refresh.
static JSValue js_ui_present(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    if (argc > 0) { JSCStringBuf buf; size_t len; const char *m = JS_ToCStringLen(c, &len, argv[0], &buf); if (m && len == 5 && !memcmp(m, "clear", 5)) force_clear = true; }
    dirty = true; return JS_UNDEFINED;
}
