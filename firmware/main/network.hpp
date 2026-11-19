#pragma once
#include <string>
#include <cstdint>
namespace note4 {
struct Command{std::string command_id,build_id,run_id,op,artifact_url,scope,release_json,title;size_t byte_length=0;int64_t created_at=0;bool local_authorized=false;};
std::string runtime_snapshot();
void record_terminal(const std::string&);
void observed_changed();bool hello_accepted();uint32_t network_poll_delay_ms();int device_http(const std::string&,const std::string&,std::string&);bool receipt_ack(const Command&,const char*,const char*);uint32_t network_dropped();void network_service();
bool wifi_setup_start();void wifi_setup_stop();bool wifi_setup_active();
// WiFi is off between syncs: bring it up, talk to the server, take it down.
bool wifi_up(uint32_t timeout_ms);void wifi_down();bool network_configured();int network_wifi_reason();bool network_round_ok();bool network_round_idle();bool receipts_pending();uint32_t network_sync_minutes();constexpr uint32_t SYNC_ALWAYS=65535;bool network_connected();void network_recalibrate();void network_set_sync_minutes(uint32_t);std::string network_ssid();
void network_init();bool next_command(Command&);void receipt(const Command&,const char*,const char*);bool provision_enrollment(const char*,const char*,const char*);bool provision(const char*,const char*,const char*,const char*,const char*,int);const char* device_token();bool artifact_authorized(const char*);
}
