#include "js_app.h"
#include "display.hpp"
bool n4_display_card(const uint8_t *p, unsigned n) { return note4::display_card(p, n); }
void n4_display_rebase(void) { note4::display_rebase(); }
void n4_display_tune(bool settle, bool compensate) { note4::display_tune(settle, compensate); }
bool n4_display_busy(void) { return note4::display_busy(); }
bool n4_display_frame(const uint8_t *p, unsigned n) { return note4::display_frame(p, n); }
