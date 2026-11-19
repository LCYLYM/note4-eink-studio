#include "input_policy.hpp"
#include <cassert>
#include <cstdio>
int main(){
 for(unsigned mode=0;mode<3;++mode){note4::InputPolicy p{mode!=1,mode!=0};
  assert(p.filter(63)==(mode==0?7u:mode==1?56u:63u));
  for(unsigned mask=0;mask<512;++mask){
   assert((p.filter(mask)&128)==(mask&128));
   if(mask&128)assert(!p.retry(mask));
   printf("%u,%u,%u,%u\n",mode,mask,p.filter(mask),p.retry(mask));
  }
 }
}
