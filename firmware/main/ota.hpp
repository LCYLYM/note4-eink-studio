#pragma once
#include "network.hpp"
#include <string>
namespace note4 {
constexpr const char* OTA_MODEL="NOTE4-ESP32-S3";
constexpr const char* OTA_LAYOUT="note4-16m-ota-v1";
constexpr unsigned OTA_ABI=1;
// Caller first quiesces work/display/audio. Cancellation callback must be nonblocking.
// Returns false on rejected/failed/cancelled update; success performs normal restart.
bool ota_execute(const Command&,const std::string& release_json,bool(*cancelled)());
// Call after local manager/storage/USB initialization, then poll from network loop.
void ota_boot_begin();
void ota_boot_poll(bool hello_accepted);
bool ota_boot_pending();
std::string ota_firmware_json();
}
