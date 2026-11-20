#!/usr/bin/env python3
"""
Builds firmware/main/js_fonts_aa.bin (N4AF v1 anti-aliased multi-font pack).
Zero-allocation XIP binary format shared verbatim by ESP32-S3 firmware and WASM preview.

Typography principles (Kindle / reMarkable / Apple / Vercel Guidelines):
  - Medium / Bold e-ink-sturdy weights (no hairline dropout at 120-150 DPI)
  - Shared typographic baseline across CJK, Latin, digits and punctuation
  - Compact optical kerning for Chinese punctuation (，。：；！？（）《》「」)
  - Tabular numerals (0-9 fixed advance) so clocks and metrics never jitter

Faces:
  id=1  sans        20x20  2-bit AA (4-level)   PingFang SC Medium (unified CJK+Latin, 3923 glyphs)
  id=2  serif       24x24  4-bit AA (16-level)  Songti SC Bold + Charter Bold (editorial headlines, ~1300 glyphs)
  id=3  display     26x36  4-bit AA (16-level)  Avenir Next Demi Bold (tabular numerals & Latin)
  id=4  display_lg  34x48  4-bit AA (16-level)  Avenir Next Demi Bold (hero clock numerals & Latin)
"""
import argparse, os, struct
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent

CLOSE_PUNCT = set('，。、：；！？）》」】』〕')
OPEN_PUNCT = set('（《「【『〔')
DIGITS = set('0123456789')


def find_pingfang():
    for root in ('/System/Library/AssetsV2', '/System/Library/Fonts', '/Library/Fonts'):
        if not os.path.isdir(root):
            continue
        for dp, _, fns in os.walk(root):
            for fn in fns:
                if fn == 'PingFang.ttc':
                    return os.path.join(dp, fn)
    return '/System/Library/Fonts/STHeiti Medium.ttc'


def gb2312_level1():
    chars = []
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            if hi == 0xD7 and lo >= 0xFA:
                continue
            try:
                ch = bytes([hi, lo]).decode('gb2312')
                if len(ch) == 1 and 0x4E00 <= ord(ch) <= 0x9FFF:
                    chars.append(ord(ch))
            except UnicodeDecodeError:
                pass
    return chars


def cjk_punct():
    extra = (
        "　、。·—…‘’“”《》〈〉「」『』【】〔〕（）！？：；，．～"
        "°℃℉¥€£±×÷•→←↑↓★☆●○◆◇■□▲△"
    )
    return [ord(c) for c in extra if ord(c) <= 0xFFFF]


def gallery_chars():
    found = set()
    for rel in ('server/src/gallery.ts', 'server/src/js-templates.ts', 'server/src/skills.ts'):
        p = ROOT / rel
        if p.exists():
            for ch in p.read_text('utf-8', errors='ignore'):
                cp = ord(ch)
                if 0x4E00 <= cp <= 0x9FFF:
                    found.add(cp)
    extra_cn = (
        "春夏秋冬风花雪月山川湖海云雾霜露晴阴雨雷电微凉温暖清寒"
        "清晨午后傍晚深夜今明昨日周星期年月日时分秒刻节气宜忌吉凶"
        "液态玻璃磨砂质感灰阶快刷精刷清晰排版字体对比实机验证桌面"
        "专注心流灵感阅读写作思考静心记录时间天气温度湿度空气指数"
        "功德退散平静安宁喜乐自由探索创造美学极简纸墨光影折射层次"
        "北京上海广州深圳杭州成都南京武汉西安苏州重庆天津厦门青岛"
        "一二三四五六七八九十百千万亿零壹贰叁肆伍陆柒捌玖拾"
        "你好世界欢迎使用今日计划待办提醒清单日历时钟倒计时番茄钟"
    )
    for ch in extra_cn:
        found.add(ord(ch))
    return sorted(found)


def render_glyph(cp, cjk_font, latin_font, cell_w, cell_h, bpp, baseline_y, tab_digit_w, gamma=1.02):
    ch = chr(cp)
    is_latin = cp < 128 or ch in '°±×÷•—·'
    font = latin_font if is_latin else cjk_font

    img = Image.new('L', (cell_w, cell_h), 0)
    draw = ImageDraw.Draw(img)

    if cp == 32:  # space
        adv = max(4, round(font.getlength(' ') or cell_w * 0.34))
        return min(cell_w, adv), bytes((cell_w * cell_h * bpp + 7) // 8)

    def try_draw(f, latin_mode):
        img.paste(0, (0, 0, cell_w, cell_h))
        bbox = draw.textbbox((0, 0), ch, font=f, anchor='ls')
        raw_adv = f.getlength(ch)
        gw = bbox[2] - bbox[0]

        # Tabular numerals: identical advance for 0-9 so clocks/metrics never shift
        if ch in DIGITS and tab_digit_w > 0:
            adv = min(cell_w, tab_digit_w)
            x_off = int(round((adv - gw) / 2)) - bbox[0]
        elif latin_mode:
            adv = max(3, min(cell_w, int(round(raw_adv))))
            x_off = int(round((adv - gw) / 2)) - bbox[0]
        elif ch in CLOSE_PUNCT:
            # Compact left-weighted optical advance for closing Chinese punctuation
            adv = max(int(round(cell_w * 0.58)), min(cell_w, gw + 4))
            x_off = 2 - bbox[0]
        elif ch in OPEN_PUNCT:
            # Compact right-weighted optical advance for opening Chinese punctuation
            adv = max(int(round(cell_w * 0.58)), min(cell_w, gw + 4))
            x_off = (adv - gw - 2) - bbox[0]
        else:
            adv = cell_w
            x_off = int(round((cell_w - gw) / 2)) - bbox[0]

        # Clamp X cleanly within cell
        if bbox[0] + x_off < 0:
            x_off = -bbox[0]
        if bbox[2] + x_off > cell_w:
            x_off = max(0, cell_w - bbox[2])

        # Shared typographic baseline for BOTH CJK and Latin (never float commas or '一'!)
        y_off = baseline_y
        if y_off + bbox[1] < 0:
            y_off = -bbox[1]
        if y_off + bbox[3] > cell_h:
            y_off = cell_h - bbox[3]

        draw.text((x_off, y_off), ch, fill=255, font=f, anchor='ls')
        return adv

    try:
        adv = try_draw(font, is_latin)
    except OSError:
        adv = try_draw(cjk_font if font is latin_font else latin_font, False)

    px = img.load()
    max_lvl = (1 << bpp) - 1
    out = bytearray((cell_w * cell_h * bpp + 7) // 8)
    bit_pos = 0
    for y in range(cell_h):
        for x in range(cell_w):
            v = px[x, y] / 255.0
            if v > 0 and gamma != 1.0:
                v = min(1.0, pow(v, 1.0 / gamma))
            q = int(round(v * max_lvl))
            if bpp == 2:
                byte_i = bit_pos >> 3
                shift = 6 - (bit_pos & 7)
                out[byte_i] |= (q & 3) << shift
                bit_pos += 2
            else:
                byte_i = bit_pos >> 3
                shift = 4 - (bit_pos & 7)
                out[byte_i] |= (q & 15) << shift
                bit_pos += 4
    return adv, bytes(out)


def load_font(path, px, idx=0, axes=None):
    f = ImageFont.truetype(path, px, index=idx)
    if axes:
        try:
            f.set_variation_by_axes(axes)
        except Exception:
            pass
    return f


def build_face(face_id, bpp, cell_w, cell_h, line_h, cps, cjk_path, cjk_idx, cjk_px, lat_path, lat_idx, lat_px, baseline_y, gamma, cjk_axes=None, lat_axes=None):
    cjk_font = load_font(cjk_path, cjk_px, cjk_idx, cjk_axes)
    lat_font = load_font(lat_path, lat_px, lat_idx, lat_axes)
    tab_digit_w = max(int(round(lat_font.getlength(d))) for d in DIGITS)
    unique_cps = sorted(set(cp for cp in cps if 32 <= cp <= 0xFFFF))
    cp_arr = bytearray()
    adv_arr = bytearray()
    bmp_arr = bytearray()
    for cp in unique_cps:
        adv, bmp = render_glyph(cp, cjk_font, lat_font, cell_w, cell_h, bpp, baseline_y, tab_digit_w, gamma)
        cp_arr += struct.pack('<H', cp)
        adv_arr.append(adv)
        bmp_arr += bmp
    return {
        'id': face_id, 'bpp': bpp, 'cell_w': cell_w, 'cell_h': cell_h, 'line_h': line_h,
        'count': len(unique_cps), 'cps': bytes(cp_arr), 'advs': bytes(adv_arr), 'bmps': bytes(bmp_arr),
    }


def main():
    default_pf = find_pingfang()
    default_pf_idx = 7 if default_pf.endswith('PingFang.ttc') else 1  # PingFang SC Medium / Heiti SC Medium

    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(ROOT / 'firmware/main/js_fonts_aa.bin'))
    ap.add_argument('--sans-cjk', default=default_pf)
    ap.add_argument('--sans-cjk-idx', type=int, default=default_pf_idx)
    ap.add_argument('--latin-sans', default=default_pf)
    ap.add_argument('--latin-sans-idx', type=int, default=default_pf_idx)
    ap.add_argument('--serif-cjk', default='/System/Library/Fonts/Supplemental/Songti.ttc')
    ap.add_argument('--serif-cjk-idx', type=int, default=1)  # Songti SC Bold (sturdy on e-ink)
    ap.add_argument('--latin-serif', default='/System/Library/Fonts/Supplemental/Charter.ttc')
    ap.add_argument('--latin-serif-idx', type=int, default=3)  # Charter Bold (classic Kindle e-ink serif)
    ap.add_argument('--display-font', default='/System/Library/Fonts/Avenir Next.ttc')
    ap.add_argument('--display-idx', type=int, default=2)  # Avenir Next Demi Bold
    ap.add_argument('--display-wght', type=int, default=0, help='Optional variable font weight axis (e.g. 650 for Inter)')
    args = ap.parse_args()
    disp_axes = [32, args.display_wght] if args.display_wght else None

    ascii_cps = list(range(32, 127))
    punct = cjk_punct()
    l1 = gb2312_level1()
    gal = gallery_chars()

    # Serif (24x24 4-bit 16-level AA): ASCII + punct + all gallery/UI/poetry chars + top 100 GB2312 L1 (~1300 glyphs, ~370 KiB)
    # Any rarer Hanzi seamlessly falls back to sans (3924 glyphs) -> pixel (full GB2312).
    serif_cps = ascii_cps + punct + gal + l1[:100]
    # Sans (20x20 2-bit AA): ASCII + punct + all 3755 GB2312 L1 + gallery chars (~3930 glyphs, ~395 KiB)
    sans_cps = ascii_cps + punct + l1 + gal
    # Display (36px & 48px 4-bit 16-level AA): tabular numerals, punctuation, degree, Latin
    disp_cps = ascii_cps + [ord(c) for c in '°℃℉¥€—·±×÷']
    disp_lg_cps = [ord(c) for c in "0123456789:.%-+/,'°℃¥ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"] + [32]

    print(f'Building anti-aliased multi-font pack (sans={os.path.basename(args.sans_cjk)}[{args.sans_cjk_idx}], serif={os.path.basename(args.serif_cjk)}[{args.serif_cjk_idx}]+{os.path.basename(args.latin_serif)}[{args.latin_serif_idx}], display={os.path.basename(args.display_font)})...')
    faces = [
        build_face(1, 2, 20, 20, 26, sans_cps, args.sans_cjk, args.sans_cjk_idx, 18, args.latin_sans, args.latin_sans_idx, 18, 16, 1.02),
        build_face(2, 4, 24, 24, 31, serif_cps, args.serif_cjk, args.serif_cjk_idx, 22, args.latin_serif, args.latin_serif_idx, 21, 20, 1.02),
        build_face(3, 4, 26, 36, 40, disp_cps, args.display_font, args.display_idx, 32, args.display_font, args.display_idx, 33, 29, 1.06, disp_axes, disp_axes),
        build_face(4, 4, 34, 48, 52, disp_lg_cps, args.display_font, args.display_idx, 44, args.display_font, args.display_idx, 45, 39, 1.06, disp_axes, disp_axes),
    ]

    def align4(buf):
        while len(buf) & 3:
            buf.append(0)

    header_size = 16 + len(faces) * 24
    body = bytearray()
    face_metas = []
    for f in faces:
        align4(body)
        cp_off = header_size + len(body)
        body += f['cps']
        align4(body)
        adv_off = header_size + len(body)
        body += f['advs']
        align4(body)
        bmp_off = header_size + len(body)
        body += f['bmps']
        face_metas.append((f, cp_off, adv_off, bmp_off))
        print(f"  face id={f['id']} {f['cell_w']}x{f['cell_h']} {f['bpp']}bpp: {f['count']} glyphs, {(len(f['cps'])+len(f['advs'])+len(f['bmps']))/1024:.1f} KiB")

    align4(body)
    total_size = header_size + len(body)
    out = bytearray()
    out += struct.pack('<4sHHII', b'N4AF', 1, len(faces), total_size, 0)
    for f, cp_off, adv_off, bmp_off in face_metas:
        out += struct.pack('<BBBBBBBBIIII', f['id'], f['bpp'], f['cell_w'], f['cell_h'], f['line_h'], 0, 0, 0, f['count'], cp_off, adv_off, bmp_off)
    out += body
    assert len(out) == total_size

    out_path = Path(args.out)
    out_path.write_bytes(out)
    print(f"Wrote {out_path} ({total_size} bytes / {total_size/1024:.1f} KiB)")


if __name__ == '__main__':
    main()
