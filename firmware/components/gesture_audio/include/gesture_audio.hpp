#pragma once

#include <cstddef>
#include <cstdint>
#include <atomic>

#include "esp_err.h"
#include "driver/i2c_master.h"

namespace ugl {

struct AudioConfig {
    uint32_t sample_rate = 48000;
    float carrier_hz = 21500.0f;
    float output_level = 0.08f;
};

class AudioCapture {
public:
    AudioCapture() = default;
    ~AudioCapture();

    esp_err_t Init(const AudioConfig& config, i2c_master_bus_handle_t shared_bus);
    esp_err_t Start();
    void Stop();
    void Shutdown();
    int Read(int16_t* samples, size_t count);
    int Write(const int16_t* samples, size_t count);
    esp_err_t SetOutputVolume(int vol);
    esp_err_t SetInputGain(float db);
    uint32_t Overruns() const;
    bool initialized() const { return codec_if_ != nullptr; }

private:
    std::atomic<uint32_t> overruns_{0};
    AudioConfig config_{};
    void* i2c_bus_ = nullptr;
    const void* data_if_ = nullptr;
    const void* ctrl_if_ = nullptr;
    const void* codec_if_ = nullptr;
    const void* gpio_if_ = nullptr;
    void* device_ = nullptr;
    void* tx_handle_ = nullptr;
    void* rx_handle_ = nullptr;
};

}  // namespace ugl
