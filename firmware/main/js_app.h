#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
enum { N4_DOTS, N4_GRAY, N4_TUNED, N4_FLASH, N4_CLEAR };
bool js_fonts_init(void);
const uint8_t *n4_font16_ptr(void);
bool js_app_start(int mode);
bool js_app_active(void);
bool js_app_load_file(const char *path, uint32_t offset, uint32_t size, const char *app_id, int mode, int frames, int frame_bytes, bool deflated);
void js_app_tick(uint32_t bits);
void js_app_stop(void);
void n4_display_tune(bool settle, bool compensate);
void js_app_inject(const char *key);
bool n4_display_card(const uint8_t *p, unsigned n);
bool n4_display_busy(void);
void n4_display_rebase(void);
bool n4_display_frame(const uint8_t *p, unsigned n);

// Declarative DSH-Micro Agent bridge (caller holds runtime lock)
bool js_agent_configured(void);
const char *js_agent_role(void);
const char *js_agent_tools_json(void);
bool js_agent_read_state(char *out, size_t cap);
bool js_agent_call_tool(const char *name, const char *args_json, char *out, size_t cap);
void js_agent_emit(const char *phase, const char *text);
bool js_agent_take_say(char *out, size_t cap);
void js_agent_store_begin_turn(void);
void js_agent_store_commit_turn(void);
void js_agent_store_rollback_turn(void);
#ifdef __cplusplus
}
#endif
