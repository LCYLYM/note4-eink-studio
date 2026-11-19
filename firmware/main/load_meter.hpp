#pragma once
#include <atomic>
#include <algorithm>
#include <cstring>
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
namespace note4 {
// Sample at 1Hz, publish interval CPU time; no formatting or heap allocation.
struct LoadMeter {
 struct Previous {TaskHandle_t handle=nullptr;uint32_t time=0;};
 Previous before[32]{};TaskStatus_t tasks[32]{};unsigned before_count=0;int64_t sampled=0;
 std::atomic<int> total{-1},display{-1},audio{-1},runtime{-1};
 void sample(){
  auto count=uxTaskGetSystemState(tasks,32,nullptr);auto now=esp_timer_get_time();
  if(!count){total=-1;return;}
  if(sampled){uint64_t idle=0,draw=0,sound=0,logic=0;unsigned idle_count=0;
   for(unsigned i=0;i<count;++i)for(unsigned j=0;j<before_count;++j)if(tasks[i].xHandle==before[j].handle){
    uint32_t delta=uint32_t(tasks[i].ulRunTimeCounter)-before[j].time;const char* name=tasks[i].pcTaskName;
    if(!strncmp(name,"IDLE",4)){idle+=delta;++idle_count;}
    if(!strcmp(name,"display_owner"))draw+=delta;
    if(!strcmp(name,"note4_audio"))sound+=delta;
    if(!strcmp(name,"local_runner"))logic+=delta;
    break;
   }
   auto elapsed=uint64_t(now-sampled);auto ratio=[&](uint64_t used){return int(std::min(uint64_t(1000),used*1000/elapsed));};
   if(elapsed){total=idle_count==CONFIG_FREERTOS_NUMBER_OF_CORES?1000-int(std::min(uint64_t(1000),idle*1000/(elapsed*CONFIG_FREERTOS_NUMBER_OF_CORES))):-1;
    display=ratio(draw);audio=ratio(sound);runtime=ratio(logic);}
  }
  before_count=count;for(unsigned i=0;i<count;++i)before[i]={tasks[i].xHandle,uint32_t(tasks[i].ulRunTimeCounter)};sampled=now;
 }
};
}
