#include "startup.hpp"
#include <cassert>
#include <cstdio>
int main(){
    note4::StartupHealth s;
    for(unsigned missing=0;missing<5;missing++){
        s.ready=31u&~(1u<<missing);
        assert(!s.managers_ready());
    }
    s.ready=31;assert(s.managers_ready());
    s.failed=true;assert(!s.managers_ready());
    puts("PASS: no readiness with any missing manager, and startup faults veto confirmation");
}
