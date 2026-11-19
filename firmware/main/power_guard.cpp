#include "power_guard.hpp"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include <atomic>
// Link-time GPIO boundary adapter: official EPD driver source/LUT remains unchanged.
extern "C" esp_err_t __real_gpio_set_level(gpio_num_t,uint32_t);
extern "C" esp_err_t __real_gpio_hold_en(gpio_num_t);
extern "C" esp_err_t __real_gpio_hold_dis(gpio_num_t);
namespace {portMUX_TYPE rail_mux=portMUX_INITIALIZER_UNLOCKED;bool latched=true;uint32_t blocked=0,epoch=0;
void cut_locked(){__real_gpio_hold_dis(GPIO_NUM_6);__real_gpio_set_level(GPIO_NUM_6,0);__real_gpio_hold_en(GPIO_NUM_6);}}
extern "C" esp_err_t __wrap_gpio_set_level(gpio_num_t pin,uint32_t value){if(pin!=GPIO_NUM_6)return __real_gpio_set_level(pin,value);portENTER_CRITICAL(&rail_mux);if(latched&&value){value=0;++blocked;}auto e=__real_gpio_set_level(pin,value);portEXIT_CRITICAL(&rail_mux);return e;}
extern "C" esp_err_t __wrap_gpio_hold_dis(gpio_num_t pin){if(pin!=GPIO_NUM_6)return __real_gpio_hold_dis(pin);portENTER_CRITICAL(&rail_mux);auto e=__real_gpio_hold_dis(pin);if(latched){__real_gpio_set_level(pin,0);}portEXIT_CRITICAL(&rail_mux);return e;}
extern "C" esp_err_t __wrap_gpio_hold_en(gpio_num_t pin){if(pin!=GPIO_NUM_6)return __real_gpio_hold_en(pin);portENTER_CRITICAL(&rail_mux);if(latched)cut_locked();auto e=__real_gpio_hold_en(pin);portEXIT_CRITICAL(&rail_mux);return e;}
namespace note4 {
void panel_emergency_cut(){portENTER_CRITICAL(&rail_mux);latched=true;++epoch;cut_locked();portEXIT_CRITICAL(&rail_mux);}
bool panel_authorize(uint32_t expected){portENTER_CRITICAL(&rail_mux);if(epoch!=expected){portEXIT_CRITICAL(&rail_mux);return false;}if(latched){__real_gpio_hold_dis(GPIO_NUM_6);__real_gpio_set_level(GPIO_NUM_6,0);latched=false;}portEXIT_CRITICAL(&rail_mux);return true;}
uint32_t panel_epoch(){portENTER_CRITICAL(&rail_mux);auto e=epoch;portEXIT_CRITICAL(&rail_mux);return e;}
bool panel_locked(){portENTER_CRITICAL(&rail_mux);bool v=latched;portEXIT_CRITICAL(&rail_mux);return v;}
int panel_power_readback(){return gpio_get_level(GPIO_NUM_6);}
uint32_t panel_blocked_writes(){portENTER_CRITICAL(&rail_mux);auto n=blocked;portEXIT_CRITICAL(&rail_mux);return n;}
}
