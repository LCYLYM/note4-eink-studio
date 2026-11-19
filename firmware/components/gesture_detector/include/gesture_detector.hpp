#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace ugl {

enum class EventType : uint8_t {
    kIdle,
    kApproach,
    kRetreat,
    kWave,
    kInvalid,
};

const char* EventTypeName(EventType type);

struct DetectorConfig {
    float carrier_hz = 21500.0f;
    uint32_t sample_rate = 48000;
    uint32_t window_samples = 2048;
    float threshold_db = 8.0f;
};

struct DetectionStats {
    float carrier_db = -120.0f;
    float sideband_db = -120.0f;
    float peak_hz = 0.0f;
    float noise_floor_db = -120.0f;
    uint32_t dropped_frames = 0;
    bool clipped = false;
};

struct DetectionEvent {
    EventType type = EventType::kIdle;
    float confidence = 0.0f;
    uint32_t duration_ms = 0;
    const char* reason = "quiet";
};

class Detector {
public:
    explicit Detector(const DetectorConfig& config = {});

    void Reset();
    DetectionEvent Process(const int16_t* samples, size_t count,
                           uint32_t dropped_frames, DetectionStats* stats);

private:
    DetectorConfig config_;
    std::vector<float> window_;
    std::vector<float> weighted_;
    float window_sum_=0.0f;
    int last_direction_ = 0;
    uint32_t active_frames_ = 0;
    uint32_t frames_since_direction_ = 0;
    bool wave_latched_ = false;
};

}  // namespace ugl
