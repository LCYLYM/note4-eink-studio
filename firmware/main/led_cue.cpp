#include "led_cue.hpp"
#include <atomic>
#include <algorithm>
#include <cmath>
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_timer.h"

namespace note4 {
namespace {

constexpr gpio_num_t kLedPin = GPIO_NUM_3;          // Active-low green status LED
constexpr gpio_num_t kChargeDetect = GPIO_NUM_2;    // 0 = charging
constexpr gpio_num_t kChargeFull = GPIO_NUM_1;      // 1 = full

std::atomic<uint8_t> g_mode{static_cast<uint8_t>(LedMode::IDLE_OFF)};
std::atomic<int64_t> g_mode_at_ms{0};
std::atomic<int64_t> g_chunk_dip_until_ms{0};
std::atomic<bool> g_led_ready{false};

adc_oneshot_unit_handle_t g_adc = nullptr;
adc_cali_handle_t g_cali = nullptr;
std::atomic<int> g_batt_mv{0};
std::atomic<int> g_batt_pct{-1};
std::atomic<int> g_chg_state{0}; // 0=battery, 1=charging, 2=full

void set_duty_10bit(uint32_t duty) {
    if (!g_led_ready.load(std::memory_order_relaxed)) return;
    duty = std::min<uint32_t>(duty, 1023u);
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
}

void led_tick(void*) {
    const int64_t now = esp_timer_get_time() / 1000;
    const auto mode = static_cast<LedMode>(g_mode.load(std::memory_order_relaxed));
    const int64_t elapsed = std::max<int64_t>(0, now - g_mode_at_ms.load(std::memory_order_relaxed));
    uint32_t duty = 0;

    switch (mode) {
        case LedMode::IDLE_OFF:
            duty = 0;
            break;
        case LedMode::PTT_ON_60:
            if (elapsed < 80) duty = 1023;
            else if (elapsed < 130) duty = 0;
            else duty = 614; // 60%
            break;
        case LedMode::LONG_SOLID_100:
            if (elapsed < 70) duty = 1023;
            else if (elapsed < 130) duty = 0;
            else if (elapsed < 200) duty = 1023;
            else if (elapsed < 255) duty = 0;
            else duty = (now < g_chunk_dip_until_ms.load(std::memory_order_relaxed)) ? 240 : 1023;
            break;
        case LedMode::THINK_BREATHE: {
            const float phase = float(elapsed % 1600) / 1600.0f * 6.2831853f;
            const float norm = 0.5f - 0.5f * std::cos(phase); // 0 -> 1 -> 0
            duty = uint32_t(102.0f + norm * 818.0f);          // 10% <-> 90%
            break;
        }
        case LedMode::SPEAKING_PULSE: {
            const float phase = float(elapsed % 1000) / 1000.0f * 6.2831853f;
            const float norm = 0.5f + 0.5f * std::sin(phase);
            duty = uint32_t(420.0f + norm * 450.0f);          // 41% <-> 85%
            break;
        }
        case LedMode::ERR_TRIPLE_BLINK:
            if (elapsed >= 480) {
                g_mode.store(static_cast<uint8_t>(LedMode::IDLE_OFF), std::memory_order_relaxed);
                duty = 0;
            } else {
                duty = ((elapsed / 80) % 2 == 0) ? 1023 : 0;
            }
            break;
    }
    set_duty_10bit(duty);
}

} // namespace

void led_power_init() {
    // 1. GPIO3 hardware LEDC PWM (output_invert=1 handles active-low LED cleanly!)
    ledc_timer_config_t tcfg{};
    tcfg.speed_mode = LEDC_LOW_SPEED_MODE;
    tcfg.duty_resolution = LEDC_TIMER_10_BIT;
    tcfg.timer_num = LEDC_TIMER_0;
    tcfg.freq_hz = 5000;
    tcfg.clk_cfg = LEDC_AUTO_CLK;
    if (ledc_timer_config(&tcfg) == ESP_OK) {
        ledc_channel_config_t ccfg{};
        ccfg.gpio_num = kLedPin;
        ccfg.speed_mode = LEDC_LOW_SPEED_MODE;
        ccfg.channel = LEDC_CHANNEL_0;
        ccfg.intr_type = LEDC_INTR_DISABLE;
        ccfg.timer_sel = LEDC_TIMER_0;
        ccfg.duty = 0;
        ccfg.hpoint = 0;
        ccfg.flags.output_invert = 1;
        if (ledc_channel_config(&ccfg) == ESP_OK) {
            g_led_ready.store(true, std::memory_order_release);
            set_duty_10bit(0);
        }
    }
    esp_timer_create_args_t ta{};
    ta.callback = &led_tick;
    ta.name = "n4_led";
    esp_timer_handle_t th = nullptr;
    if (g_led_ready && esp_timer_create(&ta, &th) == ESP_OK) {
        esp_timer_start_periodic(th, 25000); // 40 Hz smooth PWM update
    }

    // 2. Charge status inputs (GPIO2 detect active-low, GPIO1 full active-high)
    gpio_config_t chg{};
    chg.pin_bit_mask = (1ULL << kChargeDetect) | (1ULL << kChargeFull);
    chg.mode = GPIO_MODE_INPUT;
    chg.pull_up_en = GPIO_PULLUP_DISABLE;
    chg.pull_down_en = GPIO_PULLDOWN_DISABLE;
    gpio_config(&chg);

    // 3. Battery voltage ADC1_CH3 (GPIO4, x2 voltage divider)
    adc_oneshot_unit_init_cfg_t ucfg{};
    ucfg.unit_id = ADC_UNIT_1;
    if (adc_oneshot_new_unit(&ucfg, &g_adc) == ESP_OK) {
        adc_oneshot_chan_cfg_t chcfg{};
        chcfg.atten = ADC_ATTEN_DB_12;
        chcfg.bitwidth = ADC_BITWIDTH_12;
        if (adc_oneshot_config_channel(g_adc, ADC_CHANNEL_3, &chcfg) == ESP_OK) {
            adc_cali_curve_fitting_config_t cal{};
            cal.unit_id = ADC_UNIT_1;
            cal.chan = ADC_CHANNEL_3;
            cal.atten = ADC_ATTEN_DB_12;
            cal.bitwidth = ADC_BITWIDTH_12;
            adc_cali_create_scheme_curve_fitting(&cal, &g_cali);
        }
    }
    power_status_sample();
}

void led_set_mode(LedMode mode) {
    g_mode_at_ms.store(esp_timer_get_time() / 1000, std::memory_order_relaxed);
    g_mode.store(static_cast<uint8_t>(mode), std::memory_order_release);
    led_tick(nullptr);
}

LedMode led_get_mode() { return static_cast<LedMode>(g_mode.load(std::memory_order_relaxed)); }

const char* led_mode_name() {
    switch (led_get_mode()) {
        case LedMode::IDLE_OFF: return "off";
        case LedMode::PTT_ON_60: return "ptt_60";
        case LedMode::LONG_SOLID_100: return "long_100";
        case LedMode::THINK_BREATHE: return "breathe";
        case LedMode::SPEAKING_PULSE: return "speaking";
        case LedMode::ERR_TRIPLE_BLINK: return "err_blink";
    }
    return "off";
}

void led_pulse_chunk() {
    g_chunk_dip_until_ms.store(esp_timer_get_time() / 1000 + 95, std::memory_order_relaxed);
}

void power_status_sample() {
    const bool chg_low = gpio_get_level(kChargeDetect) == 0;
    const bool full_hi = gpio_get_level(kChargeFull) == 1;
    g_chg_state.store(full_hi ? 2 : (chg_low ? 1 : 0), std::memory_order_relaxed);
    if (!g_adc) return;
    int sum = 0, got = 0;
    for (int i = 0; i < 4; ++i) {
        int raw = 0;
        if (adc_oneshot_read(g_adc, ADC_CHANNEL_3, &raw) == ESP_OK) {
            int mv = 0;
            if (g_cali && adc_cali_raw_to_voltage(g_cali, raw, &mv) == ESP_OK) sum += mv * 2;
            else sum += (raw * 3100 / 4095) * 2;
            ++got;
        }
    }
    if (got > 0) {
        const int mv = sum / got;
        if (mv >= 2500 && mv <= 4500) {
            const int prev = g_batt_mv.load(std::memory_order_relaxed);
            const int filt = prev > 0 ? (prev * 3 + mv) / 4 : mv;
            g_batt_mv.store(filt, std::memory_order_relaxed);
            // Smooth piecewise LiPo curve (3300mV=0%, 3700mV=45%, 4150mV=100%)
            int pct = filt <= 3300 ? 0 : filt >= 4150 ? 100
                    : filt < 3700 ? (filt - 3300) * 45 / 400
                    : 45 + (filt - 3700) * 55 / 450;
            g_batt_pct.store(std::clamp(pct, 0, 100), std::memory_order_relaxed);
        }
    }
}

int battery_mv() { return g_batt_mv.load(std::memory_order_relaxed); }
int battery_pct() { return g_batt_pct.load(std::memory_order_relaxed); }
const char* charge_state_name() {
    const int s = g_chg_state.load(std::memory_order_relaxed);
    return s == 2 ? "full" : s == 1 ? "charging" : "discharging";
}

} // namespace note4
