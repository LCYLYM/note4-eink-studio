#pragma once
#include <cstdint>

namespace note4 {

enum class LedMode : uint8_t {
    IDLE_OFF = 0,
    PTT_ON_60 = 1,       // Crisp 80ms flash -> 60% steady green
    LONG_SOLID_100 = 2,  // Double flash -> 100% full steady green
    THINK_BREATHE = 3,   // Smooth 1.6s sine wave (10% <-> 90%)
    SPEAKING_PULSE = 4,  // Gentle 1.0s pulse while TTS speaks
    ERR_TRIPLE_BLINK = 5 // Rapid triple flash -> auto-off
};

void led_power_init();
void led_set_mode(LedMode mode);
LedMode led_get_mode();
const char* led_mode_name();
// Subtle 90ms dip during LONG_SOLID_100 to confirm a rolling chunk saved/uploaded silently.
void led_pulse_chunk();

// Sampled once per second by safety loop: battery ADC1_CH3 + GPIO2/GPIO1 charge status.
void power_status_sample();
int battery_mv();
int battery_pct();
const char* charge_state_name();

} // namespace note4
