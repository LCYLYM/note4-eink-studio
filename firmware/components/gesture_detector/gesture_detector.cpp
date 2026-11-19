#include "gesture_detector.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>

namespace ugl {
namespace {

constexpr std::array<float, 5> kOffsetsHz = {50.0f, 100.0f, 150.0f, 200.0f, 250.0f};
constexpr float kEpsilon = 1.0e-12f;
constexpr float kPi = 3.14159265358979323846f;

float GoertzelPower(const float* samples, size_t count, float sample_rate,
                   float frequency_hz, float window_sum) {
    if (samples == nullptr || count == 0 || frequency_hz <= 0.0f ||
        frequency_hz >= sample_rate * 0.5f) {
        return 0.0f;
    }
    const float omega = 2.0f * kPi * frequency_hz / sample_rate;
    const float coeff = 2.0f * std::cos(omega);
    float q1 = 0.0f;
    float q2 = 0.0f;
    for (size_t i = 0; i < count; ++i) {
        const float sample = samples[i];
        const float q0 = coeff * q1 - q2 + sample;
        q2 = q1;
        q1 = q0;
    }
    const float power = q1 * q1 + q2 * q2 - coeff * q1 * q2;
    return std::max(0.0f, power / (window_sum * window_sum));
}

float Db(float power) {
    return 10.0f * std::log10(std::max(power, kEpsilon));
}

bool IsClipped(const int16_t* samples, size_t count) {
    if (samples == nullptr || count == 0) return true;
    size_t clipped = 0;
    for (size_t i = 0; i < count; ++i) {
        if (std::abs(static_cast<int>(samples[i])) >= 32760) ++clipped;
    }
    return clipped * 100U > count;
}

}  // namespace

const char* EventTypeName(EventType type) {
    switch (type) {
        case EventType::kApproach: return "approach";
        case EventType::kRetreat: return "retreat";
        case EventType::kWave: return "wave";
        case EventType::kInvalid: return "invalid";
        case EventType::kIdle: return "idle";
    }
    return "invalid";
}

Detector::Detector(const DetectorConfig& config) : config_(config) {
    if(config.window_samples!=2048 && config.window_samples!=4096) return;
    window_.resize(config.window_samples); weighted_.resize(config.window_samples);
    for(size_t i=0;i<window_.size();++i) {
        window_[i]=0.5f-0.5f*std::cos(2.0f*kPi*i/(window_.size()-1));
        window_sum_+=window_[i];
    }
}

void Detector::Reset() {
    last_direction_ = 0;
    active_frames_ = 0;
    frames_since_direction_ = 0;
    wave_latched_ = false;
}

DetectionEvent Detector::Process(const int16_t* samples, size_t count,
                                 uint32_t dropped_frames, DetectionStats* stats) {
    DetectionStats local;
    if (stats == nullptr) stats = &local;
    *stats = {};
    stats->dropped_frames = dropped_frames;
    stats->clipped = IsClipped(samples, count);

    if (samples == nullptr || count == 0 || count!=window_.size() || config_.sample_rate!=48000) {
        Reset();
        stats->noise_floor_db = -120.0f;
        return {EventType::kInvalid, 0.0f, 0, "empty_window"};
    }

    for(size_t i=0;i<count;++i) weighted_[i]=(samples[i]/32768.0f)*window_[i];
    auto power=[&](float hz){return GoertzelPower(weighted_.data(),count,config_.sample_rate,hz,window_sum_);};
    const float carrier_power = power(config_.carrier_hz);
    stats->carrier_db = Db(carrier_power);

    float positive_power = 0.0f;
    float negative_power = 0.0f;
    float positive_peak = config_.carrier_hz;
    float negative_peak = config_.carrier_hz;
    for (const float offset : kOffsetsHz) {
        const float positive = power(config_.carrier_hz + offset);
        const float negative = power(config_.carrier_hz - offset);
        if (positive > positive_power) {
            positive_power = positive;
            positive_peak = config_.carrier_hz + offset;
        }
        if (negative > negative_power) {
            negative_power = negative;
            negative_peak = config_.carrier_hz - offset;
        }
    }
    const float sideband_power = std::max(positive_power, negative_power);
    stats->sideband_db = Db(sideband_power);
    stats->peak_hz = positive_power >= negative_power ? positive_peak : negative_peak;

    // Probe several bins away from the carrier. This is deliberately simple and
    // conservative: a noisy room must become invalid instead of an event.
    constexpr std::array<float, 6> kNoiseOffsets = {
        -900.0f, -700.0f, -500.0f, 500.0f, 700.0f, 900.0f};
    float noise_power = 0.0f;
    for (const float offset : kNoiseOffsets) {
        noise_power = std::max(noise_power, power(config_.carrier_hz + offset));
    }
    // Compare the pilot and sidebands with noise in the ultrasonic band.
    // Audible room noise is not a valid estimate of 21.5 kHz noise.
    // Keep a -40 dBc leakage floor to reject numerical sidelobes.
    const float residual_power=std::max(noise_power,carrier_power*0.0001f);
    stats->noise_floor_db = Db(residual_power);

    if (dropped_frames) { Reset(); return {EventType::kInvalid,0.0f,0,"capture_overrun"}; }
    if (stats->clipped) {
        Reset();
        return {EventType::kInvalid, 0.0f,
                static_cast<uint32_t>(count * 1000ULL / config_.sample_rate),
                "clipped"};
    }
    // NOTE4 low-level pilot measured near -61 dB, silence near -95 dB.
    // This absolute floor rejects silence; the local SNR gate below still
    // rejects strong ultrasonic noise rather than accepting any weak tone.
    if (stats->carrier_db < -80.0f) {
        Reset();
        return {EventType::kInvalid, 0.0f,
                static_cast<uint32_t>(count * 1000ULL / config_.sample_rate),
                "carrier_lost"};
    }
    if (stats->noise_floor_db > stats->carrier_db - 10.0f) {
        Reset();
        return {EventType::kInvalid, 0.0f,
                static_cast<uint32_t>(count * 1000ULL / config_.sample_rate),
                "strong_noise"};
    }

    const float snr_db = stats->sideband_db - stats->noise_floor_db;
    const float contrast_db = 10.0f * std::log10(
        (std::max(positive_power, negative_power) + kEpsilon) /
        (std::min(positive_power, negative_power) + kEpsilon));
    if (snr_db < config_.threshold_db || contrast_db < 1.5f) {
        stats->peak_hz = config_.carrier_hz;
        active_frames_ = 0;
        frames_since_direction_++;
        if (frames_since_direction_ > 20) {
            last_direction_ = 0;
            wave_latched_ = false;
        }
        return {EventType::kIdle, 0.0f,
                static_cast<uint32_t>(count * 1000ULL / config_.sample_rate),
                "below_threshold"};
    }

    const int direction = positive_power > negative_power ? 1 : -1;
    const uint32_t duration_ms = static_cast<uint32_t>(
        (++active_frames_ * count) * 1000ULL / config_.sample_rate);
    const float confidence = std::clamp(
        0.35f + (snr_db - config_.threshold_db) / 24.0f + contrast_db / 24.0f,
        0.0f, 1.0f);

    DetectionEvent event;
    event.type = direction > 0 ? EventType::kApproach : EventType::kRetreat;
    event.confidence = confidence;
    event.duration_ms = duration_ms;
    event.reason = direction > 0 ? "positive_shift" : "negative_shift";

    if (last_direction_ != 0 && direction != last_direction_ &&
        frames_since_direction_ <= 12 && !wave_latched_) {
        event.type = EventType::kWave;
        event.confidence = std::min(1.0f, confidence + 0.1f);
        event.duration_ms = static_cast<uint32_t>(
            ((frames_since_direction_ + 1) * count) * 1000ULL / config_.sample_rate);
        event.reason = "shift_sign_flip";
        wave_latched_ = true;
    }
    last_direction_ = direction;
    frames_since_direction_ = 0;
    return event;
}

}  // namespace ugl
