#pragma once
#include "interactive.hpp"
#include "core.hpp"
#include <string>
#include <vector>
namespace note4 {
struct Work {bool frame_deflate=false;int frames=0,frame_bytes=0,refresh_mode=0;std::string build_id,path,kind,character="fox";Config config;bool allow_ok=true,allow_wave=true,gesture_hud=true,hud_icon=true,hud_arrows=false;int hud_x=280,hud_y=8;uint32_t lease_ms=60000;uint32_t payload_offset=0,payload_size=0;std::string app_id;bool compressed=false;std::vector<uint32_t> pages,lengths;std::vector<Question> questions;};
std::string activation_command();bool mark_run(const std::string&);
void save_reading(const Work&,int);int restore_reading(const Work&);
bool store_init();bool validate_work(const char*,Work&,std::string&);bool stage_download(const char*,size_t,const char*,Work&,std::string&);bool activate_work(const Work&,const std::string&,std::string&);bool recover_work(Work&);bool read_page(const Work&,int,uint8_t*);
}
