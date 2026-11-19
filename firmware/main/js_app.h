#pragma once
#include <stdbool.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
enum { N4_DOTS, N4_GRAY, N4_TUNED, N4_FLASH, N4_CLEAR };
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
#ifdef __cplusplus
}
#endif
