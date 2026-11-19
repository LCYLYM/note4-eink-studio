#include "gesture_audio.hpp"
#include "i2c_bus_lock.h"

#include <algorithm>
#include <cmath>

#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/i2s_common.h"
#include "driver/i2s_std.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_log.h"

namespace ugl {
namespace {

constexpr char kTag[] = "ugl_audio";
constexpr gpio_num_t kMclk = GPIO_NUM_14;
constexpr gpio_num_t kBclk = GPIO_NUM_15;
constexpr gpio_num_t kWs = GPIO_NUM_38;
constexpr gpio_num_t kDout = GPIO_NUM_45;
constexpr gpio_num_t kDin = GPIO_NUM_16;
constexpr gpio_num_t kAudioPower = GPIO_NUM_42;
constexpr gpio_num_t kPa = GPIO_NUM_46;
constexpr gpio_num_t kSda = GPIO_NUM_47;
constexpr gpio_num_t kScl = GPIO_NUM_48;
constexpr int kDmaDescriptors = 6;
constexpr int kDmaFrames = 240;

void ForceAudioRailsOff() {
    gpio_hold_dis(kPa);
    gpio_set_level(kPa, 0);
    gpio_hold_en(kPa);
    gpio_hold_dis(kAudioPower);
    // GPIO42 also supplies shared I2C: keep it powered for NFC.
    // Capture/codec are closed and PA is muted, so static mode has no audio stream.
    gpio_set_level(kAudioPower, 1);
    gpio_hold_en(kAudioPower);
}

}  // namespace

AudioCapture::~AudioCapture() {
    Shutdown();
}

esp_err_t AudioCapture::Init(const AudioConfig& config, i2c_master_bus_handle_t shared_bus) {
    ScopedI2cBusLock lock("AudioCapture::Init");
    if (!lock.locked()) return lock.status();
    config_ = config;
    if (config_.sample_rate != 48000 || config_.carrier_hz < 20500.0f ||
        config_.carrier_hz > 23000.0f) {
        return ESP_ERR_INVALID_ARG;
    }

    // Bus belongs to peripherals for the device lifetime; NFC uses this same bus.
    if (!shared_bus) return ESP_ERR_INVALID_ARG;
    i2c_master_bus_handle_t bus = shared_bus;
    i2c_bus_ = bus;
    esp_err_t err = ESP_OK;

    i2s_chan_config_t channel_config = {};
    channel_config.id = I2S_NUM_0;
    channel_config.role = I2S_ROLE_MASTER;
    channel_config.dma_desc_num = kDmaDescriptors;
    channel_config.dma_frame_num = kDmaFrames;
    channel_config.auto_clear_after_cb = true;
    channel_config.auto_clear_before_cb = false;
    i2s_chan_handle_t tx = nullptr;
    i2s_chan_handle_t rx = nullptr;
    err = i2s_new_channel(&channel_config, &tx, &rx);
    if (err != ESP_OK) {
        Shutdown();
        return err;
    }
    tx_handle_ = tx;
    rx_handle_ = rx;
    overruns_=0;
    i2s_event_callbacks_t callbacks={};
    callbacks.on_recv_q_ovf=[](i2s_chan_handle_t, i2s_event_data_t*, void* user)->bool {
        static_cast<AudioCapture*>(user)->overruns_.fetch_add(1, std::memory_order_relaxed);
        return false;
    };
    err=i2s_channel_register_event_callback(rx,&callbacks,this);
    if(err!=ESP_OK){Shutdown();return err;}

    i2s_std_config_t std_config = {};
    std_config.clk_cfg.sample_rate_hz = config_.sample_rate;
    std_config.clk_cfg.clk_src = I2S_CLK_SRC_DEFAULT;
    std_config.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;
    std_config.slot_cfg.data_bit_width = I2S_DATA_BIT_WIDTH_16BIT;
    std_config.slot_cfg.slot_bit_width = I2S_SLOT_BIT_WIDTH_AUTO;
    std_config.slot_cfg.slot_mode = I2S_SLOT_MODE_STEREO;
    std_config.slot_cfg.slot_mask = I2S_STD_SLOT_BOTH;
    std_config.slot_cfg.ws_width = I2S_DATA_BIT_WIDTH_16BIT;
    std_config.slot_cfg.ws_pol = false;
    std_config.slot_cfg.bit_shift = true;
    std_config.gpio_cfg.mclk = kMclk;
    std_config.gpio_cfg.bclk = kBclk;
    std_config.gpio_cfg.ws = kWs;
    std_config.gpio_cfg.dout = kDout;
    std_config.gpio_cfg.din = kDin;
    err = i2s_channel_init_std_mode(tx, &std_config);
    if (err == ESP_OK) err = i2s_channel_init_std_mode(rx, &std_config);
    if (err != ESP_OK) {
        Shutdown();
        return err;
    }

    audio_codec_i2s_cfg_t i2s_config = {};
    i2s_config.port = I2S_NUM_0;
    i2s_config.rx_handle = rx;
    i2s_config.tx_handle = tx;
    const audio_codec_data_if_t* data_if = audio_codec_new_i2s_data(&i2s_config);
    if (data_if == nullptr) {
        Shutdown();
        return ESP_ERR_NO_MEM;
    }
    data_if_ = data_if;

    audio_codec_i2c_cfg_t i2c_config = {};
    i2c_config.port = I2C_NUM_0;
    i2c_config.addr = ES8311_CODEC_DEFAULT_ADDR;
    i2c_config.bus_handle = bus;
    const audio_codec_ctrl_if_t* ctrl_if = audio_codec_new_i2c_ctrl(&i2c_config);
    if (ctrl_if == nullptr) {
        Shutdown();
        return ESP_ERR_NO_MEM;
    }
    ctrl_if_ = ctrl_if;
    const audio_codec_gpio_if_t* gpio_if = audio_codec_new_gpio();
    if (gpio_if == nullptr) {
        Shutdown();
        return ESP_ERR_NO_MEM;
    }
    gpio_if_ = gpio_if;

    es8311_codec_cfg_t codec_config = {};
    codec_config.ctrl_if = ctrl_if;
    codec_config.gpio_if = gpio_if;
    codec_config.codec_mode = ESP_CODEC_DEV_WORK_MODE_BOTH;
    codec_config.pa_pin = -1; // PA exclusively belongs to the safety/control path.
    codec_config.use_mclk = true;
    codec_config.hw_gain.pa_voltage = 5.0;
    codec_config.hw_gain.codec_dac_voltage = 3.3;
    codec_config.pa_reverted = false;
    const audio_codec_if_t* codec_if = es8311_codec_new(&codec_config);
    if (codec_if == nullptr) {
        ESP_LOGE(kTag, "ES8311 codec interface creation failed");
        Shutdown();
        return ESP_FAIL;
    }
    codec_if_ = codec_if;
    ESP_LOGI(kTag, "audio interfaces prepared at %u Hz", config_.sample_rate);
    return ESP_OK;
}

esp_err_t AudioCapture::Start() {
    ScopedI2cBusLock lock("AudioCapture::Start");
    if (!lock.locked()) return lock.status();
    if (!initialized()) return ESP_ERR_INVALID_STATE;
    esp_err_t err = ESP_OK;
    esp_codec_dev_cfg_t device_config = {};
    device_config.dev_type = ESP_CODEC_DEV_TYPE_IN_OUT;
    device_config.codec_if = static_cast<const audio_codec_if_t*>(codec_if_);
    device_config.data_if = static_cast<const audio_codec_data_if_t*>(data_if_);
    auto device = esp_codec_dev_new(&device_config);
    if (device == nullptr) {
        Stop();
        return ESP_ERR_NO_MEM;
    }
    device_ = device;
    esp_codec_dev_sample_info_t sample_info = {};
    sample_info.bits_per_sample = 16;
    sample_info.channel = 2; // Two wire slots; Read returns one microphone (left).
    sample_info.channel_mask = 0;
    sample_info.sample_rate = config_.sample_rate;
    sample_info.mclk_multiple = 0;
    err = esp_codec_dev_open(device, &sample_info);
    if (err == ESP_OK) err = esp_codec_dev_set_in_gain(device, 30.0f);
    if (err == ESP_OK) {
        const int volume = 20; // Fixed low codec volume; output_level scales pilot amplitude.
        err = esp_codec_dev_set_out_vol(device, volume);
    }
    if (err != ESP_OK) {
        Stop();
        return err;
    }
    return ESP_OK;
}

void AudioCapture::Stop() {
    ScopedI2cBusLock lock("AudioCapture::Stop");
    auto device = static_cast<esp_codec_dev_handle_t>(device_);
    if (device != nullptr) {
        esp_codec_dev_close(device);
        esp_codec_dev_delete(device);
        device_ = nullptr;
    }
    auto tx = static_cast<i2s_chan_handle_t>(tx_handle_);
    auto rx = static_cast<i2s_chan_handle_t>(rx_handle_);
    if (tx != nullptr) i2s_channel_disable(tx);
    if (rx != nullptr) i2s_channel_disable(rx);
}

void AudioCapture::Shutdown() {
    ScopedI2cBusLock lock("AudioCapture::Shutdown");
    Stop();
    auto codec_if = static_cast<const audio_codec_if_t*>(codec_if_);
    auto ctrl_if = static_cast<const audio_codec_ctrl_if_t*>(ctrl_if_);
    auto gpio_if = static_cast<const audio_codec_gpio_if_t*>(gpio_if_);
    auto data_if = static_cast<const audio_codec_data_if_t*>(data_if_);
    if (codec_if != nullptr) audio_codec_delete_codec_if(codec_if);
    if (ctrl_if != nullptr) audio_codec_delete_ctrl_if(ctrl_if);
    if (gpio_if != nullptr) audio_codec_delete_gpio_if(gpio_if);
    if (data_if != nullptr) audio_codec_delete_data_if(data_if);
    codec_if_ = nullptr;
    ctrl_if_ = nullptr;
    gpio_if_ = nullptr;
    data_if_ = nullptr;
    auto tx = static_cast<i2s_chan_handle_t>(tx_handle_);
    auto rx = static_cast<i2s_chan_handle_t>(rx_handle_);
    if (tx != nullptr) i2s_del_channel(tx);
    if (rx != nullptr) i2s_del_channel(rx);
    tx_handle_ = nullptr;
    rx_handle_ = nullptr;
    // Shared I2C bus is never deleted by the audio component.
    i2c_bus_ = nullptr;
    ForceAudioRailsOff();
}

int AudioCapture::Read(int16_t* samples, size_t count) {
    if (!device_ || !samples || count==0 || count>240) return 0;
    int16_t stereo[480]; size_t bytes=0;
    const esp_err_t err=i2s_channel_read(static_cast<i2s_chan_handle_t>(rx_handle_),stereo,count*4,&bytes,100);
    if(err!=ESP_OK || bytes!=count*4) return 0;
    for(size_t i=0;i<count;++i) samples[i]=stereo[i*2];
    return static_cast<int>(count);
}
int AudioCapture::Write(const int16_t* samples, size_t count) {
    if (!device_ || !samples || count==0 || count>240) return 0;
    int16_t stereo[480]; size_t bytes=0;
    for(size_t i=0;i<count;++i) stereo[i*2]=stereo[i*2+1]=samples[i];
    const esp_err_t err=i2s_channel_write(static_cast<i2s_chan_handle_t>(tx_handle_),stereo,count*4,&bytes,100);
    return err==ESP_OK && bytes==count*4 ? static_cast<int>(count):0;
}
uint32_t AudioCapture::Overruns() const {return overruns_.load();}
} // namespace ugl
