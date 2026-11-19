#include "../main/core.hpp"
#include <cstdio>
int main(){note4::Config c;auto s=note4::initial(c);uint32_t inputs[]={1,0,2,0,4,8,16,32,64,128,1};puts("[");for(unsigned i=0;i<sizeof(inputs)/sizeof(*inputs);++i){note4::step(s,inputs[i],c);printf("{\"input\":%u,\"tick\":%u,\"seed\":%u,\"lane\":%d,\"y\":%d,\"vy\":%d,\"score\":%d,\"obstacleX\":%d,\"obstacleLane\":%d,\"alive\":%s,\"paused\":%s,\"page\":%d}%s\n",inputs[i],s.tick,s.seed,s.lane,s.y,s.vy,s.score,s.obstacleX,s.obstacleLane,s.alive?"true":"false",s.paused?"true":"false",s.page,i+1==sizeof(inputs)/sizeof(*inputs)?"":",");}puts("]");}
