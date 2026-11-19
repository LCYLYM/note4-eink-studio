// Network requests made by JS apps. The UI task enqueues; the net task sends them during Wi-Fi windows.
#pragma once
#include <stdbool.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
bool n4_net_enqueue(const char *app, const char *key, const char *url, const char *method, const char *headers, const char *body, size_t body_len, bool keep, bool user);
void n4_net_app(const char *app); // the running app changed: its short-lived requests and replies are dropped
bool n4_net_take(const char *app, char *key, int *status, char **body, size_t *len); // caller frees body
#ifdef __cplusplus
}
namespace note4 {
void net_api_init();                      // loads the retained queue; needs /data mounted
bool net_api_wants(bool user_only);       // something is worth opening Wi-Fi early for
void net_api_save();                      // writes newly retained requests to flash
void net_api_drain(bool always, bool window); // sends what is eligible; needs Wi-Fi up
void net_api_offline();                   // a window failed: short-lived requests are dropped
}
#endif
