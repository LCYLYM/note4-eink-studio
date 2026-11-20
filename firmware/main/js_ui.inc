// Drawing API shared verbatim by the device host (js_app.c) and the WASM preview (wasm/note4_vm.c).
// Expects: ctx, fb, font_start, aa_font_start, glass_tmp, dirty, force_clear, dots_mode, refresh_mode, active_font.
#ifndef JS_UI_OOB
#define JS_UI_OOB(a, b) ((void)0)
#endif
#ifndef JS_UI_LAYOUT_RESET
#define JS_UI_LAYOUT_RESET() ((void)0)
#endif
#ifndef JS_UI_SHAPE
#define JS_UI_SHAPE(x, y, w, h, g, kind) ((void)0)
#endif
#ifndef JS_UI_TEXT_BEGIN
#define JS_UI_TEXT_BEGIN(g) ((void)0)
#endif
#ifndef JS_UI_TEXT_PX
#define JS_UI_TEXT_PX(x, y, bg, fg) ((void)0)
#endif
#ifndef JS_UI_TEXT_END
#define JS_UI_TEXT_END(x0, y0, x1, y1) ((void)0)
#endif

static int arg_int(JSValue *argv, int argc, int i, int fallback) { int v; if (i >= argc || JS_ToInt32(ctx, &v, argv[i])) return fallback; return v; }
static inline int clampi(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

static inline int get_px(int x, int y) {
    if (x < 0 || y < 0 || x >= 400 || y >= 300) return 15;
    int i = y * 400 + x;
    return (i & 1) ? (fb[i >> 1] & 15) : (fb[i >> 1] >> 4);
}
static inline void px_clip(int x, int y, int g) {
    if (x < 0 || y < 0 || x >= 400 || y >= 300) return;
    g &= 15;
    int i = y * 400 + x;
    if (i & 1) fb[i >> 1] = (fb[i >> 1] & 0xf0) | g;
    else fb[i >> 1] = (fb[i >> 1] & 0x0f) | (g << 4);
}
static inline void px(int x, int y, int g) {
    if (x < 0 || y < 0 || x >= 400 || y >= 300) { JS_UI_OOB(x, y); return; }
    int i = y * 400 + x;
    if (i & 1) fb[i >> 1] = (fb[i >> 1] & 0xf0) | g;
    else fb[i >> 1] = (fb[i >> 1] & 0x0f) | (g << 4);
}
// Dot mode drives only black and white, because a mid-gray lands differently depending on the pixel's past.
// Fills become an ordered dot pattern; text stays solid so thin strokes remain readable.
static const uint8_t bayer4[4][4] = {{0, 8, 2, 10}, {12, 4, 14, 6}, {3, 11, 1, 9}, {15, 7, 13, 5}};
static inline int ink(int x, int y, int g) {
    return !dots_mode || !g || g == 15 ? g : g > bayer4[y & 3][x & 3] ? 15 : 0;
}
static inline void blend_px(int x, int y, int g, int cov) {
    if (cov <= 0 || x < 0 || y < 0 || x >= 400 || y >= 300) return;
    if (dots_mode) {
        if (cov >= 8) px_clip(x, y, ink(x, y, g));
        return;
    }
    if (cov >= 15) { px_clip(x, y, g); return; }
    int bg = get_px(x, y);
    px_clip(x, y, (bg * (15 - cov) + g * cov + 7) / 15);
}
static inline void blend_text_px(int x, int y, int g, int cov) {
    if (cov <= 0 || x < 0 || y < 0 || x >= 400 || y >= 300) return;
    if (dots_mode) {
        if (cov >= 7) px_clip(x, y, g < 11 ? 0 : 15);
        return;
    }
    if (cov >= 15) { px_clip(x, y, g); return; }
    int bg = get_px(x, y);
    px_clip(x, y, (bg * (15 - cov) + g * cov + 7) / 15);
}

static inline uint16_t rd16(const uint8_t *p) { return (uint16_t)p[0] | ((uint16_t)p[1] << 8); }
static inline uint32_t rd32(const uint8_t *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }

// ---- Legacy 16x16 1-bit pixel font ----
static const uint8_t *glyph(uint32_t c) {
    static const uint32_t r[4][2] = {{32, 127}, {12288, 12352}, {19968, 40960}, {65280, 65376}};
    uint32_t off = 0;
    for (int i = 0; i < 4; i++) { if (c >= r[i][0] && c < r[i][1]) return font_start + (off + c - r[i][0]) * 32; off += r[i][1] - r[i][0]; }
    return NULL;
}

// ---- N4AF v1 Anti-Aliased Multi-Font Pack ----
typedef struct {
    uint8_t id, bpp, cell_w, cell_h, line_h;
    uint32_t count, cp_off, adv_off, bmp_off, stride;
} aa_face_t;

static bool aa_get_face(int id, aa_face_t *out) {
    const uint8_t *base = aa_font_start;
    if (!base || id <= 0) return false;
    if (base[0] != 'N' || base[1] != '4' || base[2] != 'A' || base[3] != 'F') return false;
    uint16_t n = rd16(base + 6);
    for (uint16_t i = 0; i < n; i++) {
        const uint8_t *e = base + 16 + i * 24;
        if (e[0] == (uint8_t)id) {
            out->id = e[0]; out->bpp = e[1]; out->cell_w = e[2]; out->cell_h = e[3]; out->line_h = e[4];
            out->count = rd32(e + 8); out->cp_off = rd32(e + 12); out->adv_off = rd32(e + 16); out->bmp_off = rd32(e + 20);
            out->stride = (uint32_t)(out->cell_w * out->cell_h * out->bpp + 7) / 8;
            return true;
        }
    }
    return false;
}

static bool aa_find_glyph(const aa_face_t *f, uint32_t cp, int *adv_out, const uint8_t **bmp_out) {
    if (cp > 0xffff || !f->count) return false;
    const uint8_t *cps = aa_font_start + f->cp_off;
    uint32_t lo = 0, hi = f->count;
    while (lo < hi) {
        uint32_t mid = lo + ((hi - lo) >> 1);
        uint16_t v = rd16(cps + mid * 2);
        if (v == (uint16_t)cp) {
            *adv_out = aa_font_start[f->adv_off + mid];
            *bmp_out = aa_font_start + f->bmp_off + mid * f->stride;
            return true;
        }
        if (v < (uint16_t)cp) lo = mid + 1; else hi = mid;
    }
    return false;
}

static uint32_t next_utf8(const char *s, size_t len, size_t *pos) {
    size_t i = *pos;
    uint8_t b = (uint8_t)s[i]; uint32_t cp = b; int n = 1;
    if (b >= 0xf0) { cp = b & 7; n = 4; } else if (b >= 0xe0) { cp = b & 15; n = 3; } else if (b >= 0xc0) { cp = b & 31; n = 2; }
    for (int k = 1; k < n && i + k < len; k++) cp = (cp << 6) | ((uint8_t)s[i + k] & 63);
    *pos = i + n;
    return cp;
}

static int measure_cp(uint32_t cp, int scale, const aa_face_t *primary, const aa_face_t *fallback) {
    if (primary) {
        int adv = 0; const uint8_t *bmp = NULL;
        if (aa_find_glyph(primary, cp, &adv, &bmp)) return adv * scale;
        if (fallback && aa_find_glyph(fallback, cp, &adv, &bmp)) return adv * scale;
    }
    return (cp < 128 ? 9 : 16) * scale;
}

// ---- Core Clear & Rect ----
static JSValue js_ui_clear(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    int g = arg_int(argv, argc, 0, 15) & 15;
    JS_UI_LAYOUT_RESET();
    if (!dots_mode || !g || g == 15) memset(fb, g * 0x11, FB_SIZE);
    else for (int y = 0; y < 300; y++) for (int x = 0; x < 400; x++) px_clip(x, y, ink(x, y, g));
    return JS_UNDEFINED;
}
static JSValue js_ui_rect(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    int x = arg_int(argv, argc, 0, 0), y = arg_int(argv, argc, 1, 0), w = arg_int(argv, argc, 2, 0), h = arg_int(argv, argc, 3, 0), g = arg_int(argv, argc, 4, 0) & 15;
    if (w <= 0 || h <= 0) return JS_UNDEFINED;
    JS_UI_SHAPE(x, y, w, h, g, (w <= 3 || h <= 3) ? 2 : 0);
    int64_t xe = (int64_t)x + w, ye = (int64_t)y + h;
    if (x < 0 || y < 0 || xe > 400 || ye > 300) JS_UI_OOB(x < 0 ? x : (xe > 400 ? 400 : (int)xe), y < 0 ? y : (ye > 300 ? 300 : (int)ye));
    if (xe > 400) xe = 400;
    if (ye > 300) ye = 300;
    for (int yy = y < 0 ? 0 : y; yy < ye; yy++) for (int xx = x < 0 ? 0 : x; xx < xe; xx++) px(xx, yy, ink(xx, yy, g));
    return JS_UNDEFINED;
}

// ---- Typography: ui.font(name, size), ui.measure(str, scale), ui.text(...) ----
static JSValue js_ui_font(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    if (argc < 1) {
        aa_face_t f;
        return JS_NewInt32(c, (active_font > 0 && aa_get_face(active_font, &f)) ? f.line_h : 22);
    }
    JSCStringBuf buf; size_t len; const char *name = JS_ToCStringLen(c, &len, argv[0], &buf);
    if (!name) return JS_EXCEPTION;
    int size = arg_int(argv, argc, 1, 0);
    if (len == 5 && !memcmp(name, "pixel", 5)) active_font = 0;
    else if (len == 4 && !memcmp(name, "sans", 4)) active_font = 1;
    else if (len == 5 && !memcmp(name, "serif", 5)) active_font = 2;
    else if (len == 10 && !memcmp(name, "display_lg", 10)) active_font = 4;
    else if (len == 7 && !memcmp(name, "display", 7)) active_font = (size >= 44) ? 4 : 3;
    else return JS_ThrowTypeError(c, "ui.font must be pixel, sans, serif, display or display_lg");
    aa_face_t f;
    if (active_font > 0 && aa_get_face(active_font, &f)) return JS_NewInt32(c, f.line_h);
    active_font = 0;
    return JS_NewInt32(c, 22);
}

static JSValue js_ui_measure(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    if (argc < 1) return JS_NewInt32(c, 0);
    int scale = clampi(arg_int(argv, argc, 1, 1), 1, 4);
    JSCStringBuf buf; size_t len; const char *s = JS_ToCStringLen(c, &len, argv[0], &buf);
    if (!s) return JS_EXCEPTION;
    aa_face_t f1, f2;
    const aa_face_t *pf = (active_font > 0 && aa_get_face(active_font, &f1)) ? &f1 : NULL;
    const aa_face_t *ff = (pf && active_font != 1 && aa_get_face(1, &f2)) ? &f2 : NULL;
    int w = 0, maxw = 0;
    for (size_t i = 0; i < len;) {
        uint32_t cp = next_utf8(s, len, &i);
        if (cp == '\n') { if (w > maxw) maxw = w; w = 0; continue; }
        w += measure_cp(cp, scale, pf, ff);
    }
    return JS_NewInt32(c, w > maxw ? w : maxw);
}

static JSValue js_ui_mode(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    static const char *names[5] = {"fast", "gray", "tuned", "flash", "clear"};
    int m = (refresh_mode >= 0 && refresh_mode < 5) ? refresh_mode : (dots_mode ? 0 : 4);
    return JS_NewString(c, names[m]);
}

static void draw_aa_glyph(int x, int y, int scale, int g, const aa_face_t *f, const uint8_t *bmp) {
    int cw = f->cell_w, ch = f->cell_h, bpp = f->bpp;
    int bit_pos = 0;
    for (int yy = 0; yy < ch; yy++) {
        for (int xx = 0; xx < cw; xx++) {
            int cov;
            if (bpp == 2) {
                int q = (bmp[bit_pos >> 3] >> (6 - (bit_pos & 7))) & 3;
                cov = q * 5;
                bit_pos += 2;
            } else {
                cov = (bmp[bit_pos >> 3] >> (4 - (bit_pos & 7))) & 15;
                bit_pos += 4;
            }
            if (!cov) continue;
            if (scale == 1) {
                int px_x = x + xx, px_y = y + yy;
                if (px_x < 0 || px_y < 0 || px_x >= 400 || px_y >= 300) { JS_UI_OOB(px_x, px_y); continue; }
                if (cov >= 5) JS_UI_TEXT_PX(px_x, px_y, get_px(px_x, px_y), g);
                blend_text_px(px_x, px_y, g, cov);
            } else {
                for (int a = 0; a < scale; a++)
                    for (int d = 0; d < scale; d++) {
                        int px_x = x + xx * scale + d, px_y = y + yy * scale + a;
                        if (px_x < 0 || px_y < 0 || px_x >= 400 || px_y >= 300) { JS_UI_OOB(px_x, px_y); continue; }
                        if (cov >= 5) JS_UI_TEXT_PX(px_x, px_y, get_px(px_x, px_y), g);
                        blend_text_px(px_x, px_y, g, cov);
                    }
            }
        }
    }
}

// ui.text(x, y, string, scale=1, gray=0, maxWidth=400-x) returns the next line's y.
static JSValue js_ui_text(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    int x0 = arg_int(argv, argc, 0, 0), y = arg_int(argv, argc, 1, 0);
    if (argc < 3) return JS_ThrowTypeError(c, "ui.text needs x,y,string");
    int scale = arg_int(argv, argc, 3, 1), g = arg_int(argv, argc, 4, 0) & 15, maxw = arg_int(argv, argc, 5, 400 - x0);
    if (dots_mode) g = g < 11 ? 0 : 15;
    if (scale < 1 || scale > 4) return JS_ThrowTypeError(c, "ui.text scale must be 1..4");
    JSCStringBuf buf; size_t len; const char *s = JS_ToCStringLen(c, &len, argv[2], &buf);
    if (!s) return JS_EXCEPTION;

    aa_face_t f1, f2;
    const aa_face_t *pf = (active_font > 0 && aa_get_face(active_font, &f1)) ? &f1 : NULL;
    const aa_face_t *ff = (pf && active_font != 1 && aa_get_face(1, &f2)) ? &f2 : NULL;
    int line_step = pf ? pf->line_h * scale : 22 * scale;
    int glyph_h = pf ? pf->cell_h * scale : 16 * scale;
    int x = x0;
    int tx1 = 400, ty1 = 300, tx2 = -1, ty2 = -1;
    JS_UI_TEXT_BEGIN(g);

    for (size_t i = 0; i < len;) {
        uint32_t cp = next_utf8(s, len, &i);
        if (cp == '\n') { x = x0; y += line_step; continue; }
        int adv = 0;
        const uint8_t *bmp = NULL;
        const aa_face_t *used = NULL;
        if (pf) {
            if (aa_find_glyph(pf, cp, &adv, &bmp)) used = pf;
            else if (ff && aa_find_glyph(ff, cp, &adv, &bmp)) used = ff;
        }
        int step_x = used ? adv * scale : (cp < 128 ? 9 : 16) * scale;
        if (x > x0 && x + step_x > x0 + maxw) { x = x0; y += line_step; }
        if (cp != ' ') {
            if (x < tx1) tx1 = x;
            if (y < ty1) ty1 = y;
            if (x + step_x > tx2) tx2 = x + step_x;
            if (y + glyph_h > ty2) ty2 = y + glyph_h;
        }
        if (used) {
            int y_adj = y + (pf && used != pf ? ((int)pf->cell_h - (int)used->cell_h) * scale / 2 : 0);
            draw_aa_glyph(x, y_adj, scale, g, used, bmp);
        } else {
            const uint8_t *m = glyph(cp);
            int y_adj = pf ? y + ((int)pf->cell_h - 16) * scale / 2 : y;
            if (m) for (int yy = 0; yy < 16; yy++) for (int xx = 0; xx < 16; xx++) if (m[yy * 2 + (xx >> 3)] & (128 >> (xx & 7)))
                for (int a = 0; a < scale; a++) for (int d = 0; d < scale; d++) {
                    int px_x = x + xx * scale + d, px_y = y_adj + yy * scale + a;
                    if (px_x >= 0 && px_y >= 0 && px_x < 400 && px_y < 300) JS_UI_TEXT_PX(px_x, px_y, get_px(px_x, px_y), g);
                    px(px_x, px_y, g);
                }
        }
        x += step_x;
    }
    if (tx2 > tx1 && ty2 > ty1) JS_UI_TEXT_END(tx1, ty1, tx2, ty2);
    return JS_NewInt32(c, y + line_step);
}

// ---- Geometry & Rounded SDF Coverage (integer 2x2 supersampled AA) ----
static inline int rrect_cov(int px_x, int px_y, int x, int y, int w, int h, int r) {
    if (px_x < x || px_y < y || px_x >= x + w || px_y >= y + h) return 0;
    if (r <= 0) return 15;
    // Fast interior check
    int lx = px_x - x, ly = px_y - y;
    int rx = (x + w - 1) - px_x, ry = (y + h - 1) - px_y;
    int cx = lx < r ? r - lx : rx < r ? r - rx : 0;
    int cy = ly < r ? r - ly : ry < r ? r - ry : 0;
    if (!cx || !cy) return 15;
    // 2x2 subpixel supersampling in quarter-pixel units (center offset 0.25 / 0.75)
    int r4 = r * 4, r4sq = r4 * r4;
    int hits = 0;
    for (int sy = 0; sy < 2; sy++) {
        int dy = (cy - 1) * 4 + (sy ? 3 : 1);
        for (int sx = 0; sx < 2; sx++) {
            int dx = (cx - 1) * 4 + (sx ? 3 : 1);
            if (dx * dx + dy * dy <= r4sq) hits++;
        }
    }
    return hits * 15 / 4;
}

static JSValue js_ui_rrect(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    int x = arg_int(argv, argc, 0, 0), y = arg_int(argv, argc, 1, 0);
    int w = arg_int(argv, argc, 2, 0), h = arg_int(argv, argc, 3, 0);
    int r = arg_int(argv, argc, 4, 8), g = arg_int(argv, argc, 5, 0) & 15;
    if (w <= 0 || h <= 0) return JS_UNDEFINED;
    JS_UI_SHAPE(x, y, w, h, g, (w <= 3 || h <= 3) ? 2 : 0);
    if (r < 0) r = 0;
    if (r * 2 > w) r = w / 2;
    if (r * 2 > h) r = h / 2;
    int64_t xe = (int64_t)x + w, ye = (int64_t)y + h;
    if (x < 0 || y < 0 || xe > 400 || ye > 300) JS_UI_OOB(x < 0 ? x : (xe > 400 ? 400 : (int)xe), y < 0 ? y : (ye > 300 ? 300 : (int)ye));
    int x1 = clampi(x, 0, 400), y1 = clampi(y, 0, 300);
    int x2 = (int)(xe > 400 ? 400 : xe), y2 = (int)(ye > 300 ? 300 : ye);
    for (int yy = y1; yy < y2; yy++) {
        for (int xx = x1; xx < x2; xx++) {
            int cov = rrect_cov(xx, yy, x, y, w, h, r);
            if (cov) blend_px(xx, yy, g, cov);
        }
    }
    return JS_UNDEFINED;
}

static JSValue js_ui_rbox(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    int x = arg_int(argv, argc, 0, 0), y = arg_int(argv, argc, 1, 0);
    int w = arg_int(argv, argc, 2, 0), h = arg_int(argv, argc, 3, 0);
    int r = arg_int(argv, argc, 4, 8), g = arg_int(argv, argc, 5, 0) & 15;
    int th = clampi(arg_int(argv, argc, 6, 1), 1, 12);
    if (w <= 0 || h <= 0) return JS_UNDEFINED;
    JS_UI_SHAPE(x, y, w, h, g, 1);
    if (r < 0) r = 0;
    if (r * 2 > w) r = w / 2;
    if (r * 2 > h) r = h / 2;
    int ir = r > th ? r - th : 0;
    int x1 = clampi(x, 0, 400), y1 = clampi(y, 0, 300);
    int x2 = clampi(x + w, 0, 400), y2 = clampi(y + h, 0, 300);
    for (int yy = y1; yy < y2; yy++) {
        for (int xx = x1; xx < x2; xx++) {
            int outer = rrect_cov(xx, yy, x, y, w, h, r);
            if (!outer) continue;
            int inner = (w > th * 2 && h > th * 2) ? rrect_cov(xx, yy, x + th, y + th, w - th * 2, h - th * 2, ir) : 0;
            int cov = outer - inner;
            if (cov > 0) blend_px(xx, yy, g, cov);
        }
    }
    return JS_UNDEFINED;
}

static JSValue js_ui_circle(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    int cx = arg_int(argv, argc, 0, 0), cy = arg_int(argv, argc, 1, 0);
    int r = arg_int(argv, argc, 2, 0), g = arg_int(argv, argc, 3, 0) & 15;
    if (r <= 0) return JS_UNDEFINED;
    JS_UI_SHAPE(cx - r, cy - r, r * 2, r * 2, g, 3);
    int x1 = clampi(cx - r, 0, 400), y1 = clampi(cy - r, 0, 300);
    int x2 = clampi(cx + r + 1, 0, 400), y2 = clampi(cy + r + 1, 0, 300);
    int r4 = r * 4, r4sq = r4 * r4;
    for (int yy = y1; yy < y2; yy++) {
        for (int xx = x1; xx < x2; xx++) {
            int dx0 = (xx - cx) * 4, dy0 = (yy - cy) * 4;
            int hits = 0;
            for (int sy = -1; sy <= 1; sy += 2)
                for (int sx = -1; sx <= 1; sx += 2) {
                    int dx = dx0 + sx, dy = dy0 + sy;
                    if (dx * dx + dy * dy <= r4sq) hits++;
                }
            if (hits) blend_px(xx, yy, g, hits * 15 / 4);
        }
    }
    return JS_UNDEFINED;
}

static JSValue js_ui_line(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    int x0 = arg_int(argv, argc, 0, 0), y0 = arg_int(argv, argc, 1, 0);
    int x1 = arg_int(argv, argc, 2, 0), y1 = arg_int(argv, argc, 3, 0);
    int g = arg_int(argv, argc, 4, 0) & 15, th = clampi(arg_int(argv, argc, 5, 1), 1, 16);
    int minx = clampi((x0 < x1 ? x0 : x1) - th, 0, 400);
    int maxx = clampi((x0 > x1 ? x0 : x1) + th + 1, 0, 400);
    int miny = clampi((y0 < y1 ? y0 : y1) - th, 0, 300);
    int maxy = clampi((y0 > y1 ? y0 : y1) + th + 1, 0, 300);
    JS_UI_SHAPE(minx, miny, maxx - minx, maxy - miny, g, 2);
    int64_t vx = x1 - x0, vy = y1 - y0, len2 = vx * vx + vy * vy;
    // Capsule distance in quarter-pixel units
    int rad2 = (th * 2 + 1) * (th * 2 + 1); // (th/2 + 0.25)*4
    for (int yy = miny; yy < maxy; yy++) {
        for (int xx = minx; xx < maxx; xx++) {
            int64_t pxv = xx - x0, pyv = yy - y0;
            int64_t d2_x16;
            if (len2 == 0) {
                d2_x16 = (pxv * pxv + pyv * pyv) * 16;
            } else {
                int64_t proj = pxv * vx + pyv * vy;
                if (proj <= 0) d2_x16 = (pxv * pxv + pyv * pyv) * 16;
                else if (proj >= len2) { int64_t ex = xx - x1, ey = yy - y1; d2_x16 = (ex * ex + ey * ey) * 16; }
                else {
                    int64_t cross = pxv * vy - pyv * vx;
                    d2_x16 = (cross * cross * 16) / len2;
                }
            }
            if (d2_x16 <= rad2) {
                int cov = d2_x16 <= (th * 2 - 1) * (th * 2 - 1) ? 15 : (int)((rad2 - d2_x16) * 15 / (rad2 - (th * 2 - 1) * (th * 2 - 1) + 1));
                blend_px(xx, yy, g, clampi(cov, 0, 15));
            }
        }
    }
    return JS_UNDEFINED;
}

// Smooth gradient with 4x4 Bayer micro-dithering between gray levels (zero banding on 16-gray & 4-gray e-ink)
static JSValue js_ui_grad(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    int x = arg_int(argv, argc, 0, 0), y = arg_int(argv, argc, 1, 0);
    int w = arg_int(argv, argc, 2, 0), h = arg_int(argv, argc, 3, 0);
    int g0 = arg_int(argv, argc, 4, 15) & 15, g1 = arg_int(argv, argc, 5, 10) & 15;
    int dir = arg_int(argv, argc, 6, 0); // 0=vertical, 1=horizontal, 2=diagonal
    if (w <= 0 || h <= 0) return JS_UNDEFINED;
    if (x <= 0 && y <= 0 && w >= 400 && h >= 300) JS_UI_LAYOUT_RESET();
    else JS_UI_SHAPE(x, y, w, h, (g0 + g1) / 2, 0);
    int x1 = clampi(x, 0, 400), y1 = clampi(y, 0, 300);
    int x2 = clampi(x + w, 0, 400), y2 = clampi(y + h, 0, 300);
    int span = dir == 1 ? (w > 1 ? w - 1 : 1) : dir == 2 ? ((w + h) > 2 ? w + h - 2 : 1) : (h > 1 ? h - 1 : 1);
    for (int yy = y1; yy < y2; yy++) {
        for (int xx = x1; xx < x2; xx++) {
            int pos = dir == 1 ? (xx - x) : dir == 2 ? ((xx - x) + (yy - y)) : (yy - y);
            // Fixed-point 16x gray value in [0..240]
            int val16 = g0 * 16 + ((g1 - g0) * 16 * pos) / span;
            int g;
            if (dots_mode) {
                int avg = clampi((val16 + 8) >> 4, 0, 15);
                g = ink(xx, yy, avg);
            } else {
                int lo = val16 >> 4;
                int frac = val16 & 15;
                g = clampi(lo + (frac > bayer4[yy & 3][xx & 3] ? 1 : 0), 0, 15);
            }
            px_clip(xx, yy, g);
        }
    }
    return JS_UNDEFINED;
}

// ---- Native Liquid Glass Primitive: ui.glass(x, y, w, h, r=14, tint=14, blur=6) ----
// Separable 2-pass sliding-window box blur O(w*h), multi-ring soft shadow,
// translucent frosted glass tint + specular top-left catchlight & bottom-right refraction rim.
static JSValue js_ui_glass(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    int x = arg_int(argv, argc, 0, 0), y = arg_int(argv, argc, 1, 0);
    int w = arg_int(argv, argc, 2, 0), h = arg_int(argv, argc, 3, 0);
    int r = arg_int(argv, argc, 4, 14);
    int tint = arg_int(argv, argc, 5, 14) & 15;
    int br = clampi(arg_int(argv, argc, 6, 6), 0, 12);
    if (w <= 4 || h <= 4) return JS_UNDEFINED;
    JS_UI_SHAPE(x, y, w, h, tint, 4);
    if (r < 0) r = 0;
    if (r * 2 > w) r = w / 2;
    if (r * 2 > h) r = h / 2;
    int64_t xe = (int64_t)x + w, ye = (int64_t)y + h;
    if (x < 0 || y < 0 || xe > 400 || ye > 300) JS_UI_OOB(x < 0 ? x : (xe > 400 ? 400 : (int)xe), y < 0 ? y : (ye > 300 ? 300 : (int)ye));

    // Step 1: Soft outer drop shadow (auto-tiered by waveform)
    if (dots_mode) {
        int sx1 = clampi(x + 2, 0, 400), sy1 = clampi(y + 3, 0, 300);
        int sx2 = clampi(x + w + 2, 0, 400), sy2 = clampi(y + h + 3, 0, 300);
        for (int yy = sy1; yy < sy2; yy++) {
            for (int xx = sx1; xx < sx2; xx++) {
                if (rrect_cov(xx, yy, x, y, w, h, r) >= 8) continue;
                if (rrect_cov(xx - 2, yy - 3, x, y, w, h, r) >= 8) px_clip(xx, yy, ink(xx, yy, 10));
            }
        }
    } else {
        int rings = (refresh_mode == 4) ? 3 : 2;
        for (int ring = rings; ring >= 1; ring--) {
            int ox = ring, oy = ring + 1;
            int pad = ring - 1;
            int dark = (refresh_mode == 4) ? (rings + 1 - ring) : (ring == 1 ? 4 : 2);
            int sx1 = clampi(x + ox - pad, 0, 400), sy1 = clampi(y + oy - pad, 0, 300);
            int sx2 = clampi(x + w + ox + pad, 0, 400), sy2 = clampi(y + h + oy + pad, 0, 300);
            for (int yy = sy1; yy < sy2; yy++) {
                for (int xx = sx1; xx < sx2; xx++) {
                    if (rrect_cov(xx, yy, x, y, w, h, r) >= 12) continue;
                    int scov = rrect_cov(xx - ox, yy - oy, x - pad, y - pad, w + pad * 2, h + pad * 2, r + pad);
                    if (scov > 0) {
                        int bg = get_px(xx, yy);
                        int drop = (dark * scov + 7) / 15;
                        px_clip(xx, yy, bg > drop ? bg - drop : 0);
                    }
                }
            }
        }
    }

    int x1 = clampi(x, 0, 400), y1 = clampi(y, 0, 300);
    int x2 = clampi(x + w, 0, 400), y2 = clampi(y + h, 0, 300);
    int rw = x2 - x1, rh = y2 - y1;
    if (rw <= 0 || rh <= 0) return JS_UNDEFINED;

    // Fast 1-bit mode: crisp rounded card + clean 1px rim
    if (dots_mode || !glass_tmp) {
        int fill_g = tint >= 8 ? 15 : 0;
        int rim_g = tint >= 8 ? 0 : 15;
        int ir = r > 1 ? r - 1 : 0;
        for (int yy = y1; yy < y2; yy++) {
            for (int xx = x1; xx < x2; xx++) {
                int cov = rrect_cov(xx, yy, x, y, w, h, r);
                if (cov < 8) continue;
                int in1 = rrect_cov(xx, yy, x + 1, y + 1, w - 2, h - 2, ir);
                px_clip(xx, yy, in1 < 8 ? rim_g : fill_g);
            }
        }
        return JS_UNDEFINED;
    }

    // Step 2: True smooth frosted blur (2-iteration separable box blur ≈ Gaussian, O(rw*rh), ~5ms)
    int eff_br = (refresh_mode == 4) ? br : (br > 3 ? 3 : br);
    for (int j = 0; j < rh; j++) {
        uint8_t *row = glass_tmp + j * rw;
        int yy = y1 + j;
        for (int i = 0; i < rw; i++) row[i] = (uint8_t)get_px(x1 + i, yy);
    }
    if (eff_br > 0) {
        int passes = (refresh_mode == 4) ? 2 : 1;
        int win = eff_br * 2 + 1;
        uint8_t line[400];
        uint8_t col[300];
        for (int pass = 0; pass < passes; pass++) {
            for (int j = 0; j < rh; j++) {
                uint8_t *row = glass_tmp + j * rw;
                int sum = 0;
                for (int k = -eff_br; k <= eff_br; k++) sum += row[clampi(k, 0, rw - 1)];
                for (int i = 0; i < rw; i++) {
                    line[i] = (uint8_t)((sum + eff_br) / win);
                    sum += row[clampi(i + eff_br + 1, 0, rw - 1)] - row[clampi(i - eff_br, 0, rw - 1)];
                }
                memcpy(row, line, (size_t)rw);
            }
            for (int i = 0; i < rw; i++) {
                int sum = 0;
                for (int k = -eff_br; k <= eff_br; k++) sum += glass_tmp[clampi(k, 0, rh - 1) * rw + i];
                for (int j = 0; j < rh; j++) {
                    col[j] = (uint8_t)((sum + eff_br) / win);
                    sum += glass_tmp[clampi(j + eff_br + 1, 0, rh - 1) * rw + i] - glass_tmp[clampi(j - eff_br, 0, rh - 1) * rw + i];
                }
                for (int j = 0; j < rh; j++) glass_tmp[j * rw + i] = col[j];
            }
        }
    }

    // Step 3: Translucent glass tint + seamless Bayer-dithered vertical lens sheen + liquid specular rim
    bool is16 = (refresh_mode == 4);
    int ir1 = r > 1 ? r - 1 : 0;
    int ir2 = r > 2 ? r - 2 : 0;
    int blur_wt = is16 ? 44 : 30;
    int tint_wt = 100 - blur_wt;
    int hspan = rh > 1 ? rh - 1 : 1;

    for (int j = 0; j < rh; j++) {
        int yy = y1 + j;
        // Continuous 16x sub-level vertical sheen (+16 at top smoothly fading to -12 at bottom, zero banding!)
        int sheen16 = is16 ? (16 - (28 * j) / hspan) : 0;
        for (int i = 0; i < rw; i++) {
            int xx = x1 + i;
            int cov = rrect_cov(xx, yy, x, y, w, h, r);
            if (!cov) continue;
            int blurred = glass_tmp[j * rw + i];
            int val16 = ((blurred * blur_wt + tint * tint_wt) * 16 + 50) / 100 + sheen16;
            int base;
            if (is16) {
                int lo = val16 >> 4;
                int frac = val16 & 15;
                base = clampi(lo + (frac > bayer4[yy & 3][xx & 3] ? 1 : 0), 0, 15);
            } else {
                base = clampi((val16 + 8) >> 4, 0, 15);
            }

            int in1 = (w > 2 && h > 2) ? rrect_cov(xx, yy, x + 1, y + 1, w - 2, h - 2, ir1) : 0;
            int in2 = (w > 4 && h > 4) ? rrect_cov(xx, yy, x + 2, y + 2, w - 4, h - 4, ir2) : 0;

            int col_g = base;
            // Outer 1px hairline refraction contour (crisp in both 16-gray and 4-gray)
            if (in1 < 12) {
                if (is16) {
                    bool upper_left = (yy - y) * w + (xx - x) * h < w * h;
                    col_g = tint >= 8 ? (upper_left ? clampi(base - 4, 5, 11) : clampi(base - 5, 2, 10))
                                      : (upper_left ? clampi(base + 5, 6, 14) : clampi(base + 2, 3, 10));
                } else {
                    col_g = tint >= 8 ? 8 : 11;
                }
            } else if (in2 < 12) {
                // Inner 1px luminous specular catchlight (top & left bright gleam)
                bool top_or_left = (yy - y <= 2 + r / 2 && (yy - y) < (y + h - 1 - yy)) || (xx - x <= 2 + r / 2 && (xx - x) < (x + w - 1 - xx));
                if (top_or_left) {
                    col_g = tint >= 8 ? 15 : clampi(tint + 7, 8, 15);
                } else if (is16) {
                    col_g = clampi(base - 1, 0, 15);
                }
            }
            blend_px(xx, yy, col_g, cov);
        }
    }
    return JS_UNDEFINED;
}

// ui.present() uses the app's refresh mode; ui.present('clear') forces one 16-gray refresh.
static JSValue js_ui_present(JSContext *c, JSValue *t, int argc, JSValue *argv) {
    argc &= ~FRAME_CF_CTOR;
    if (argc > 0) {
        JSCStringBuf buf; size_t len; const char *m = JS_ToCStringLen(c, &len, argv[0], &buf);
        if (m && len == 5 && !memcmp(m, "clear", 5)) force_clear = true;
    }
    dirty = true;
    return JS_UNDEFINED;
}
