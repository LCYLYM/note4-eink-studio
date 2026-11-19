#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
namespace note4 {
bool display_init();void display_message(const std::string&,uint32_t expected=UINT32_MAX);uint32_t display_dropped();
bool display_card(const uint8_t*,size_t);
bool display_frame(const uint8_t*,size_t);
void display_tune(bool settle,bool compensate);void display_rebase();
void display_stop();void display_home();
bool display_busy();
bool display_drive_active();uint32_t display_scans();uint32_t display_scan_us();uint32_t display_submitted();
void display_clear_fault();bool display_ready();bool display_fault();
}
