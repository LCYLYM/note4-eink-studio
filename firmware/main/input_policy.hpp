#pragma once
#include <cstdint>
namespace note4 {
struct InputPolicy {
 bool buttons=true,gestures=true;
 uint32_t filter(uint32_t mask)const {if(!buttons)mask&=~7u;if(!gestures)mask&=~56u;return mask;}
 bool retry(uint32_t mask)const {return !(mask&128)&&bool(filter(mask)&15);}
 const char* name()const {return buttons?(gestures?"both":"buttons"):"gestures";}
};
}
