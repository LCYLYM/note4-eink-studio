#pragma once
#include <atomic>
#include <cstdint>
namespace note4 {
enum Manager : uint32_t { USB_MANAGER=1, RUNTIME_MANAGER=2, SAFETY_MANAGER=4, BUTTON_MANAGER=8, DISPLAY_MANAGER=16 };
struct StartupHealth {
    std::atomic<uint32_t> ready{0};
    std::atomic<bool> failed{false};
    bool managers_ready() const { return !failed && ready.load()==31; }
};
void startup_ready(Manager);
void startup_failed(const char*);
bool runtime_startup_failed();
}
