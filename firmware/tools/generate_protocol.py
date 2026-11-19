#!/usr/bin/env python3
"""Generate firmware's production validator from shared wire protocol."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
p=json.loads((root/'shared/protocol.json').read_text())
out=['#pragma once','#include <cstring>','namespace note4::protocol {']
for key in ['receipt_states','runtime_states','terminal_states','work_stages','ota_stages']:
    out.append('inline constexpr const char* '+key+'[] = {'+','.join(json.dumps(x) for x in p[key])+'};')
out+=['template<unsigned N> inline bool contains(const char* s,const char* const (&a)[N]){for(auto* v:a)if(!std::strcmp(s,v))return true;return false;}','inline bool receipt_valid(const char*s){return contains(s,receipt_states);}','inline bool terminal(const char*s){return contains(s,terminal_states);}','}']
(root/'firmware/main/protocol.hpp').write_text('\n'.join(out)+'\n')
