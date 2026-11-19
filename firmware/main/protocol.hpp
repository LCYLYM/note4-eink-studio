#pragma once
#include <cstring>
namespace note4::protocol {
inline constexpr const char* receipt_states[] = {"created","downloading","verified","staged","activating","running","stopped","failed","cancelled","completed","duplicate","rebooting","ready","confirmed","rolled_back"};
inline constexpr const char* runtime_states[] = {"running","stopped","completed"};
inline constexpr const char* terminal_states[] = {"running","stopped","failed","cancelled","completed","duplicate","confirmed","rolled_back"};
inline constexpr const char* work_stages[] = {"created","downloading","verified","staged","activating","running"};
inline constexpr const char* ota_stages[] = {"created","downloading","verified","rebooting","ready","confirmed"};
template<unsigned N> inline bool contains(const char* s,const char* const (&a)[N]){for(auto* v:a)if(!std::strcmp(s,v))return true;return false;}
inline bool receipt_valid(const char*s){return contains(s,receipt_states);}
inline bool terminal(const char*s){return contains(s,terminal_states);}
}
