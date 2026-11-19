// NOTE4 runner ABI 1. Keep identical to firmware/main/core.hpp.
export const TICK_MS=50;
export const defaults={seed:1,speed:8,jump:18,gravity:3,obstacle_every:400};
export function initial(c=defaults){return {tick:0,seed:c.seed>>>0,lane:1,y:0,vy:0,score:0,obstacleX:c.obstacle_every,obstacleLane:0,alive:true,paused:false,page:0,choice:0};}
export function rng(x){x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;}
export function step(s,input,c=defaults){s.tick=(s.tick+1)>>>0;if(input&128){s.paused=true;return s;}if(s.paused||!s.alive)return s;if((input&9)&&s.y===0)s.vy=c.jump;if(input&36)s.lane=(s.lane+1)%3;if(input&18)s.lane=(s.lane+2)%3;s.y+=s.vy;if(s.y<=0){s.y=0;s.vy=0;}else s.vy-=c.gravity;s.obstacleX-=c.speed;if(s.obstacleX<0){s.obstacleX=c.obstacle_every;s.seed=rng(s.seed);s.obstacleLane=s.seed%3;++s.score;}if(s.obstacleX>=32&&s.obstacleX<=56&&s.lane===s.obstacleLane&&s.y<12)s.alive=false;return s;}
export function cardStep(s,input,pages){s.tick=(s.tick+1)>>>0;if(input&128){s.paused=true;return s;}if(s.paused||pages<1)return s;if(input&2)s.page=(s.page+pages-1)%pages;else if(input&69)s.page=(s.page+1)%pages;return s;}
