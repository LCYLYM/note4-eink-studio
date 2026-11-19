#pragma once
#include <cstdint>
namespace note4 {void panel_emergency_cut();bool panel_authorize(uint32_t expected);uint32_t panel_epoch();bool panel_locked();int panel_power_readback();uint32_t panel_blocked_writes();}
