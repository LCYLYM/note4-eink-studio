#pragma once
#include <cstdint>
namespace note4 {void runtime_status_changed();uint32_t cancellation_generation();void accept_server_time(int64_t);bool runtime_high_load();bool runtime_stop_latched();bool runtime_derated();void request_setup();bool runtime_local_ready();}
