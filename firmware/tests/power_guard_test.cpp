// Same production power_guard.cpp; simulated GPIO hold semantics, NOT a hardware test.
#include "../main/power_guard.hpp"
#include "driver/gpio.h"
#include <cassert>
#include <cstdio>
static bool hold=false;static int level=0;
extern "C" esp_err_t __real_gpio_set_level(gpio_num_t,unsigned value){if(!hold)level=value;return 0;}
extern "C" esp_err_t __real_gpio_hold_en(gpio_num_t){hold=true;return 0;}
extern "C" esp_err_t __real_gpio_hold_dis(gpio_num_t){hold=false;return 0;}
int gpio_get_level(gpio_num_t){return level;}
extern "C" esp_err_t __wrap_gpio_set_level(gpio_num_t,unsigned);
extern "C" esp_err_t __wrap_gpio_hold_en(gpio_num_t);
extern "C" esp_err_t __wrap_gpio_hold_dis(gpio_num_t);
int main(){using namespace note4;panel_emergency_cut();auto old=panel_epoch();assert(panel_authorize(old));__wrap_gpio_hold_dis(GPIO_NUM_6);__wrap_gpio_set_level(GPIO_NUM_6,1);__wrap_gpio_hold_en(GPIO_NUM_6);assert(level==1&&hold);assert(panel_authorize(old));assert(level==1&&hold);panel_emergency_cut();assert(level==0&&hold);__wrap_gpio_hold_dis(GPIO_NUM_6);__wrap_gpio_set_level(GPIO_NUM_6,1);__wrap_gpio_hold_en(GPIO_NUM_6);assert(level==0&&hold);assert(!panel_authorize(old));assert(panel_authorize(panel_epoch()));__wrap_gpio_hold_dis(GPIO_NUM_6);__wrap_gpio_set_level(GPIO_NUM_6,1);panel_emergency_cut();__wrap_gpio_hold_en(GPIO_NUM_6);assert(level==0&&hold);assert(panel_blocked_writes()==1);puts("PASS production GPIO6 adapter: idempotent live authorization, hold handoff, STOP late-write interleavings, stale authorization rejected; SIMULATED GPIO only");}
