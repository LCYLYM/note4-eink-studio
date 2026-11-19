#pragma once
#include <cstdint>
namespace note4 {
// Initialize after /data SPIFFS mount; no writes to NFC occur here.
void peripherals_init();bool nfc_ready();bool audio_ready();bool input_bus_ready();
// OR-latched logical input mask. 128 is global stop; consume every <=50ms.
uint32_t take_inputs();const char* gesture_feedback();
// Nonblocking; false immediately mutes PA; audio owner closes codec safely.
void audio_enable(bool enabled);
// Explicit commissioning only: preserves full user area before first write.
bool nfc_write_url(const char* url);
bool nfc_restore_userdata();
}
