from pathlib import Path
import json
root=Path(__file__).resolve().parents[1];data=json.loads((root/'shared/gesture-icons.json').read_text());icons=data['patterns']
assert all(len(rows)==16 and all(len(row)==16 and set(row)<={'0','1'} for row in rows) for rows in icons.values())
(root/'web/gesture-icons.js').write_text('export const gestureIcons='+json.dumps(icons)+';\n')
lines=['#pragma once','#include <cstdint>','namespace note4 {']
for key,rows in icons.items():lines.append('inline constexpr uint16_t icon_'+key+'[16]={'+','.join(hex(int(row,2)) for row in rows)+'};')
lines.append('}');(root/'firmware/main/gesture_icons.hpp').write_text('\n'.join(lines)+'\n')
