#pragma once
#include <cstdint>
namespace note4 {
constexpr uint32_t TICK_MS=50;
struct Config {uint32_t seed=1;int speed=8,jump=18,gravity=3,obstacle_every=400;};
struct State {uint32_t tick=0,seed=1;int lane=1,y=0,vy=0,score=0,obstacleX=400,obstacleLane=0;bool alive=true,paused=false;int page=0,choice=0;};
inline uint32_t rng(uint32_t x){x^=x<<13;x^=x>>17;x^=x<<5;return x;}
inline State initial(const Config& c){State s;s.seed=c.seed;s.obstacleX=c.obstacle_every;return s;}
inline void step(State& s,uint32_t input,const Config& c){
 ++s.tick;
 if(input&128){s.paused=true;return;}
 if(s.paused||!s.alive)return;
 if((input&(1|8))&&s.y==0)s.vy=c.jump;
 if(input&(4|32))s.lane=(s.lane+1)%3;
 if(input&(2|16))s.lane=(s.lane+2)%3;
 s.y+=s.vy;if(s.y<=0){s.y=0;s.vy=0;}else s.vy-=c.gravity;
 s.obstacleX-=c.speed;
 if(s.obstacleX<0){s.obstacleX=c.obstacle_every;s.seed=rng(s.seed);s.obstacleLane=s.seed%3;++s.score;}
 if(s.obstacleX>=32&&s.obstacleX<=56&&s.lane==s.obstacleLane&&s.y<12)s.alive=false;
}
inline void card_step(State& s,uint32_t input,int pages){++s.tick;if(input&128){s.paused=true;return;}if(s.paused||pages<1)return;if(input&2)s.page=(s.page+pages-1)%pages;else if(input&(1|4|64))s.page=(s.page+1)%pages;}
}
