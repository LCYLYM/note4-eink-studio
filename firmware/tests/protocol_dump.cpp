#include "../main/protocol.hpp"
#include <cstdio>
int main(){for(auto*s:note4::protocol::work_stages){if(!note4::protocol::receipt_valid(s))return 1;printf("receipt:%s\n",s);}for(auto*s:note4::protocol::runtime_states)printf("observed:%s\n",s);return note4::protocol::receipt_valid("nonsense")?1:0;}
