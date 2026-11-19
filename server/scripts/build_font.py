"""Regenerate bundled monochrome NotoCJK glyphs (requires Pillow/system Noto)."""
from pathlib import Path
import base64, json, sys
from PIL import Image, ImageDraw, ImageFont
font = ImageFont.truetype(sys.argv[1] if len(sys.argv)>1 else '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 16)
ranges = [(32,127),(0x3000,0x3040),(0x4e00,0xa000),(0xff00,0xff60)]
data = bytearray()
for lo, hi in ranges:
    for code in range(lo, hi):
        image=Image.new('1',(16,16))
        ImageDraw.Draw(image).text((0,-4),chr(code),font=font,fill=1)
        data.extend(image.tobytes())
Path(__file__).resolve().parents[1].joinpath('src/font.ts').write_text('export const ranges='+json.dumps(ranges)+';\nexport const fontData="'+base64.b64encode(data).decode()+'";\n')
