#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
namespace motion {
// Brightness estimate 0..12, seeded from the actual OTP binary pixel bit.
// One successfully delivered unit changes the model by one. This is a
// calibrated-endpoint approximation, not a measurement of particle position.
constexpr uint16_t unit_action(unsigned states,unsigned desired,bool soft=false){
 unsigned next=0,mask=0,active=0;
 for(unsigned p=0;p<2;++p){
  unsigned s=(states>>(4*(1-p)))&15;if(s>12)s=12;
  const unsigned level=(desired>>(2*(1-p)))&3;
  const unsigned want=soft?(level==0?1:level==1?4:level==2?8:12):level*4;
  unsigned code=0;
  if(s>want){--s;code=2;++active;}else if(s<want){++s;code=3;++active;}
  next=(next<<4)|s;mask=(mask<<2)|code;
 }
 return uint16_t((next<<8)|(active<<4)|mask);
}
constexpr std::array<uint16_t,4096> unit_actions(bool soft=false){
 std::array<uint16_t,4096> a{};
 for(unsigned s=0;s<256;++s)for(unsigned w=0;w<16;++w)a[s*16+w]=unit_action(s,w,soft);
 return a;
}
constexpr auto unit_lut=unit_actions();
constexpr std::array<uint8_t,4096> unit_masks(bool soft=false){
 std::array<uint8_t,4096> a{};
 for(unsigned s=0;s<256;++s)for(unsigned w=0;w<16;++w)a[s*16+w]=unit_action(s,w,soft)&63;
 return a;
}
constexpr auto unit_mask_lut=unit_masks();
constexpr auto unit_soft_mask_lut=unit_masks(true);
constexpr std::array<uint8_t,16> unit_desired(bool soft=false){
 std::array<uint8_t,16> a{};
 for(unsigned w=0;w<16;++w){
  auto target=[soft](unsigned c){return soft?(c==0?1:c==1?4:c==2?8:12):c*4;};
  a[w]=(target(w>>2)<<4)|target(w&3);
 }
 return a;
}
constexpr auto unit_desired_lut=unit_desired();
constexpr auto unit_soft_desired_lut=unit_desired(true);
constexpr std::array<int8_t,16> unit_deltas(){
 std::array<int8_t,16> a{};
 for(unsigned m=0;m<16;++m){
  auto d=[](unsigned c){return c==2?-1:c==3?1:0;};
  a[m]=16*d(m>>2)+d(m&3);
 }
 return a;
}
constexpr auto unit_delta_lut=unit_deltas();
struct UnitPlan {
 uint8_t* state;size_t bytes;bool soft=false; // state needs 2*bytes, two 4-bit pixels per byte.
 void seed_binary(const uint8_t* otp){
  for(size_t i=0;i<bytes;++i){
   state[2*i]=((otp[i]&0x40)?0xc0:0)|((otp[i]&0x10)?12:0);
   state[2*i+1]=((otp[i]&4)?0xc0:0)|((otp[i]&1)?12:0);
  }
 }
 unsigned prepare(const uint8_t* wanted,uint8_t* mask)const{
  unsigned active=0;
  const auto& targets=soft?unit_soft_desired_lut:unit_desired_lut;
  const auto& masks=soft?unit_soft_mask_lut:unit_mask_lut;
  for(size_t i=0;i<bytes;++i){
   unsigned hi=wanted[i]>>4,lo=wanted[i]&15;
   uint8_t a=state[2*i]==targets[hi]?0:masks[unsigned(state[2*i])*16+hi];
   uint8_t b=state[2*i+1]==targets[lo]?0:masks[unsigned(state[2*i+1])*16+lo];
   mask[i]=uint8_t((a<<4)|(b&15));
   active+=((a>>4)&3)+((b>>4)&3);
  }
  return active;
 }
 void delivered(const uint8_t* mask){
  for(size_t i=0;i<bytes;++i){
   if(!mask[i])continue;
   // prepare forbids stepping past either endpoint, so no nibble carry/borrow.
   state[2*i]+=unit_delta_lut[mask[i]>>4];
   state[2*i+1]+=unit_delta_lut[mask[i]&15];
  }
 }
};
}
