#pragma once
#include <cstddef>
#include <cstdint>

namespace note4 {

enum VoiceKeyMode : uint8_t {
    VOICE_KEY_OFF = 0,
    VOICE_KEY_PTT = 1,
    VOICE_KEY_LONG = 2,
    VOICE_KEY_BOTH = 3,
};

enum VoiceInputBit : uint32_t {
    INPUT_VOICE_PTT_START   = 512,
    INPUT_VOICE_PTT_STOP    = 1024,
    INPUT_VOICE_LONG_TOGGLE = 2048,
    INPUT_VOICE_CANCEL      = 4096,
};

enum CueTone : uint8_t {
    CUE_NONE       = 0,
    CUE_PTT_START  = 1,
    CUE_PTT_STOP   = 2,
    CUE_LONG_START = 3,
    CUE_LONG_STOP  = 4,
    CUE_DONE       = 5,
    CUE_CANCEL     = 6,
};

using AudioMicSink = void (*)(const int16_t* pcm16k, size_t samples);

// Initialize after /data SPIFFS mount; no writes to NFC occur here.
void peripherals_init();
bool nfc_ready();
bool audio_ready();
bool input_bus_ready();

// OR-latched logical input mask. 128 is global stop; consume every <=50ms.
uint32_t take_inputs();
const char* gesture_feedback();

// Nonblocking ultrasonic gesture toggle; false mutes PA when no cue/TTS is playing.
void audio_enable(bool enabled);

// Voice button & unified 48kHz audio bus controls (recording + cue tones + 24kHz TTS).
void voice_configure_keys(VoiceKeyMode mode, bool double_click_long);
void voice_set_state_flags(bool long_recording, bool busy_cancellable);
void audio_play_cue(CueTone cue);
bool audio_cue_busy();
void audio_mic_start(AudioMicSink sink);
void audio_mic_stop();
bool audio_mic_capturing();

bool audio_tts_begin(size_t initial_prebuf_samples = 14400);
size_t audio_tts_push(const int16_t* pcm24k, size_t samples, uint32_t timeout_ms);
void audio_tts_finish();
void audio_tts_abort();
bool audio_tts_playing();
uint32_t audio_tts_underruns();

// Explicit commissioning only: preserves full user area before first write.
bool nfc_write_url(const char* url);
bool nfc_restore_userdata();

} // namespace note4
