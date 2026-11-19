#pragma once
#include "core.hpp"
#include <vector>
#include <cstdio>
#include <cstring>
namespace note4 {
struct Question {int choices=0,answer=0;};
inline void reader_step(State&s,uint32_t input,int count){if(s.paused||count<1)return;if(input&2)s.page=s.page>0?s.page-1:0;else if(input&(1|4|64))s.page=s.page+1<count?s.page+1:count-1;}
inline void quiz_step(State&s,uint32_t input,const std::vector<Question>&qs){if(s.paused||qs.empty())return;int end=qs.size()*3;if(s.page==end){if(input&(1|64)){s.page=0;s.score=0;s.choice=0;}return;}int q=s.page/3;if(q<0||q>=int(qs.size()))return;if(s.page%3){if(input&(1|64)){s.page=(q+1)*3;s.choice=0;}return;}if(input&2)s.choice=(s.choice+qs[q].choices-1)%qs[q].choices;else if(input&4)s.choice=(s.choice+1)%qs[q].choices;else if(input&(1|64)){bool right=s.choice==qs[q].answer;if(right)++s.score;s.page+=right?1:2;}}
}
