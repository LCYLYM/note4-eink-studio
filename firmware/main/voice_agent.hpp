#pragma once
#include <cstdint>
#include <string>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "store.hpp"

namespace note4 {

// Initialize PSRAM voice agent state & worker task (pass runtime mutex for safe JS tool calls).
void voice_agent_init(SemaphoreHandle_t runtime_lock);

// Configure voice pipeline when active Work starts or stops.
void voice_agent_bind_work(const Work& w);
void voice_agent_stop_all(bool play_cancel_cue = false);

// Handle voice input bits (512=PTT_START, 1024=PTT_STOP, 2048=LONG_TOGGLE, 4096=CANCEL).
void voice_agent_on_bits(uint32_t bits);

// NVS "n4_ai" credential management (never logs plaintext token).
bool voice_set_cred(const char* kind, const char* token, const char* base_url, const char* model, int64_t rev = 0);
bool voice_clear_cred(int64_t rev = 0);
bool voice_has_cred();
int64_t voice_cred_rev();
const char* voice_cred_kind();
const char* voice_phase_name();

// Cloud sync helper called from network.cpp when server advertises newer ai_cred_rev.
void voice_sync_cred_if_needed(int64_t server_rev);

// USB simulation & hardware verification hooks:
// 1) Inject simulated ASR text straight into on-device C DSH-Micro Agent kernel (uses real LLM!)
bool voice_sim_utterance(const char* text);
// 2) Toggle mock ASR/TTS mode for offline/pre-login voice pipeline stress testing
void voice_set_mock(bool enabled, const char* mock_chunk_text);
// 3) Run hardware/pipeline self-checks via USB ("led_*", "cue_*", "tts_tone", "rec_stress")
std::string voice_usb_diag(const char* action, int duration_ms);

} // namespace note4
