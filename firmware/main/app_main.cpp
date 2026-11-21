#include "net_api.h"
#include "zectrix_ascii_font_8x16.h"
#include "interactive.hpp"
#include "core.hpp"
#include "gesture_icons.hpp"
#include "mbedtls/sha256.h"
#include "startup.hpp"
#include "load_meter.hpp"
#include "input_policy.hpp"
#include "esp_system.h"
#include "esp_pm.h"
#include "esp_app_desc.h"
#include <string>
#include "runtime_control.hpp"
#include "power_guard.hpp"
#include "ota.hpp"
#include "protocol.hpp"
#include "../../shared/characters.hpp"
#include "display.hpp"
#include "zectrix_ascii_font_8x16.h"
#include "store.hpp"
#include "usb_work.hpp"
#include "js_app.h"
#include "network.hpp"
#include "peripherals.hpp"
#include "led_cue.hpp"
#include "voice_agent.hpp"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_timer.h"
#include "esp_random.h"
#include "esp_heap_caps.h"
#include "driver/gpio.h"
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "driver/temperature_sensor.h"
#include "cJSON.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include <atomic>
#include <algorithm>
#include <mutex>
#include <cstdio>
#include <cstring>
#include <sys/time.h>
#ifndef CONFIG_NOTE4_USB_TRANSPORT
#define CONFIG_NOTE4_USB_TRANSPORT 0
#endif
#ifndef CONFIG_NOTE4_USB_LAB_MODE
#define CONFIG_NOTE4_USB_LAB_MODE 0
#endif
namespace note4 {namespace {
StartupHealth startup_health;std::atomic<const char*> startup_error{"initializing"};std::atomic<bool> nvs_ok{false};
std::atomic<bool> usb_event_pending{false};
std::atomic<bool> sync_requested{false};
std::atomic<bool> js_reload{false};LoadMeter load_meter;SemaphoreHandle_t lock,command_lock;Work active;State state;std::atomic<bool> running{false},game_over{false};int last_page=-1,last_choice=-1;int64_t reading_dirty_at=0;bool reading_dirty=false;int64_t deadline=0,next_frame=0;std::string last_feedback;std::atomic<uint32_t> inputs{0};std::atomic<bool> emergency{false};std::atomic<uint32_t> stop_generation{0};std::atomic<int> temperature_mc{-127000};Command current;bool mounted=false;uint8_t*frame,*page;temperature_sensor_handle_t temp=nullptr;std::atomic<bool> derated{false},stop_dirty{false},stop_latched{false},setup_requested{false};std::atomic<uint32_t> min_heap{UINT32_MAX};std::atomic<int> stop_reason{0};std::atomic<uint32_t> input_events{0},last_input{0},retry_count{0};std::atomic<bool> ota_running{false};uint32_t ota_generation=0;std::atomic<int64_t> stop_cutoff{0};std::atomic<bool> acoustic_allowed{false},active_motion{false};
void halt(bool revoke=true){usb_event_pending=true;setup_requested=false;if(revoke){timeval tv{};gettimeofday(&tv,nullptr);stop_cutoff=tv.tv_sec>1600000000?int64_t(tv.tv_sec)*1000+tv.tv_usec/1000:-1;}stop_latched=true;acoustic_allowed=false;stop_dirty=true;game_over=false;inputs=0;++stop_generation;emergency=true;voice_agent_stop_all(false);voice_configure_keys(VOICE_KEY_OFF,true);display_stop();audio_enable(false);}
void pixels(int x,int y,int w,int h,int level){for(int yy=std::max(0,y);yy<std::min(300,y+h);++yy)for(int xx=std::max(0,x);xx<std::min(400,x+w);++xx){int i=yy*400+xx,shift=6-2*(i%4);frame[i/4]=(frame[i/4]&~(3<<shift))|(level<<shift);}}
void text(int x,int y,const char* value,int scale=1){
 for(unsigned char ch; (ch=*value++);){if(ch<32||ch>126)continue;int i=ch-32,w=kZectrixAsciiFontWidths[i];
  for(int yy=0;yy<16;++yy)for(int xx=0;xx<w;++xx)if(kZectrixAsciiFont8x16[i][yy]&(0x8000>>xx))pixels(x+xx*scale,y+yy*scale,scale,scale,0);
  x+=(w+1)*scale;
 }
}
void render(){
 memset(frame,255,30000);for(int l=0;l<3;++l)pixels(0,100+l*65,400,2,2);
 const uint8_t*sprite=active.character=="penguin"?PENGUIN:FOX;
 for(int yy=0;yy<24;++yy)for(int xx=0;xx<16;++xx){int v=sprite[yy*16+xx];if(v)pixels(40+xx,76+state.lane*65-state.y+yy,1,1,v-1);}
 pixels(state.obstacleX,76+state.obstacleLane*65,18,24,1);
 char score[48];snprintf(score,sizeof score,"PENGUIN RUN   SCORE %d",state.score);text(10,8,score);
 text(10,264,active.allow_ok?(active.allow_wave?"OK/WAVE: JUMP  UP/DOWN: LANE":"OK: JUMP   UP/DOWN: LANE"):"WAVE: JUMP   NEAR/AWAY: LANE");
 if(active.gesture_hud){last_feedback=gesture_feedback();if(!active.hud_icon)text(active.hud_x,active.hud_y,last_feedback.c_str());else{const uint16_t*bitmap=last_feedback=="US:NEAR"?icon_near:last_feedback=="US:AWAY"?icon_away:last_feedback=="US:WAVE"?icon_wave:last_feedback=="US:INVALID"?icon_invalid:last_feedback=="US:OFF"?icon_off:icon_idle;if(active.hud_arrows&&last_feedback=="US:WAVE")bitmap=icon_near;for(int y=0;y<16;++y)for(int x=0;x<16;++x)if(bitmap[y]&(0x8000>>x))pixels(active.hud_x+x,active.hud_y+y,1,1,0);}}
 if(!state.alive){pixels(76,108,248,88,3);pixels(76,108,248,2,0);pixels(76,194,248,2,0);text(98,117,"GAME OVER",2);text(96,161,active.allow_ok?(active.allow_wave?"KEY / WAVE: RETRY":"ANY KEY: RETRY"):"WAVE: RETRY");}
 display_frame(frame,30000);
}
void quiz_overlay(uint8_t*page,const State&s,int count){auto pixel=[&](int x,int y){size_t i=y*400+x;page[i/2]&=(i%2?0xf0:0x0f);};const uint8_t digits[10][5]={{31,17,17,17,31},{4,12,4,4,14},{31,1,31,16,31},{31,1,15,1,31},{17,17,31,1,1},{31,16,31,1,31},{31,16,31,17,31},{31,1,2,4,4},{31,17,31,17,31},{31,17,31,1,31}};auto number=[&](int value,int x){char b[12];snprintf(b,sizeof b,"%d",value);for(int i=0;b[i];++i)for(int y=0;y<5;y++)for(int k=0;k<5;k++)if(digits[b[i]-'0'][y]&(16>>k))for(int a=0;a<2;a++)for(int d=0;d<2;d++)pixel(x+i*14+k*2+a,276+y*2+d);};auto label=[&](const char*text,int x){for(int i=0;text[i];++i){int idx=text[i]-32;for(int y=0;y<16;y++)for(int k=0;k<kZectrixAsciiFontWidths[idx];k++)if(kZectrixAsciiFont8x16[idx][y]&(0x8000>>k))pixel(x+k,272+y);x+=kZectrixAsciiFontWidths[idx]+1;}};label("SCORE",20);number(s.score,85);label("/",115);number(count,130);if(s.page<count*3&&s.page%3==0){label("CHOICE",260);number(s.choice+1,340);}}

// System page: firmware-owned status and settings, so it works whatever app is installed.
std::atomic<bool> sys_open{false},sys_request{false},sys_toggle{false},sys_dirty{false},sys_enter{false},sync_changed{false};std::atomic<int> sync_phase{0},low_power_mode{0},lp_req{0};std::atomic<int64_t> last_sync_ok{0};int sys_cursor=0;std::string app_title,sys_notice;std::mutex notice_mutex;
const uint8_t* sys_glyph(uint32_t c){const uint8_t* sf=n4_font16_ptr();if(!sf)return nullptr;static const uint32_t r[4][2]={{32,127},{12288,12352},{19968,40960},{65280,65376}};uint32_t off=0;for(auto&a:r){if(c>=a[0]&&c<a[1])return sf+(off+c-a[0])*32;off+=a[1]-a[0];}return nullptr;}
int sys_text(int x,int y,const std::string&s,int level=0,int scale=1,int limit=384){for(size_t i=0;i<s.size();){uint8_t b=s[i];uint32_t cp=b;int n=1;if(b>=0xf0){cp=b&7;n=4;}else if(b>=0xe0){cp=b&15;n=3;}else if(b>=0xc0){cp=b&31;n=2;}for(int k=1;k<n&&i+k<s.size();++k)cp=(cp<<6)|(uint8_t(s[i+k])&63);i+=n;int adv=(cp<128?9:16)*scale;if(x+adv>limit)break;if(auto*m=sys_glyph(cp))for(int yy=0;yy<16;++yy)for(int xx=0;xx<16;++xx)if(m[yy*2+(xx>>3)]&(128>>(xx&7)))pixels(x+xx*scale,y+yy*scale,scale,scale,level);x+=adv;}return x;}
int sys_width(const std::string&s,int scale=1){int w=0;for(unsigned char c:s){if(c<128)w+=9;else if(c>=0xc0)w+=16;}return w*scale;}
std::string sync_label(uint32_t m){if(!m)return "仅手动";if(m==SYNC_ALWAYS)return "持久连接";if(m<60)return "每 "+std::to_string(m)+" 分钟";if(m<1440)return "每 "+std::to_string(m/60)+" 小时";return "每天";}
std::string sync_status(){if(!network_configured())return "未设置，请在电脑上添加设备";switch(sync_phase.load()){case 1:return "正在连接 WiFi";case 2:return "正在检查更新";case 5:return "正在下载应用";case 3:{int r=network_wifi_reason();return r==201?"找不到这个 WiFi，需要 2.4GHz":r==15||r==2||r==204||r==205?"WiFi 密码不对":"连不上 WiFi，错误 "+std::to_string(r);}case 4:return "连不上服务器，稍后再试";}int64_t at=last_sync_ok;if(!at)return "尚未同步";int64_t min=(esp_timer_get_time()-at)/60000000;return min<1?"刚刚已同步":min<60?std::to_string(min)+" 分钟前已同步":std::to_string(min/60)+" 小时前已同步";}
void enter_low_power_locked(bool cut_battery){
 running=false;game_over=false;sys_open=false;js_app_stop();
 voice_agent_stop_all(false);voice_configure_keys(VOICE_KEY_OFF,true);
 audio_enable(false);led_set_mode(LedMode::IDLE_OFF);wifi_down();
 display_clear_fault();display_tune(true,false);memset(frame,255,30000);
 std::string t1=cut_battery?"NOTE4 已关机":"已进入低功耗待机";
 std::string t2=cut_battery?"插充电线自动开机 · 插USB时按确认唤醒":"屏幕与WiFi已关闭 · 按确认键唤醒";
 sys_text((400-sys_width(t1,2))/2,108,t1,0,2);
 sys_text((400-sys_width(t2))/2,166,t2,0);
 display_frame(frame,30000);
 for(int i=0;i<35;++i){vTaskDelay(pdMS_TO_TICKS(20));if(i>8&&!display_busy())break;}
 display_stop();
 low_power_mode=cut_battery?2:1;
 printf("NOTE4 POWER {\"mode\":\"%s\",\"usb_retained\":true}\n",cut_battery?"power_off":"standby");
 fflush(stdout);
 if(cut_battery){gpio_hold_dis(GPIO_NUM_17);gpio_set_level(GPIO_NUM_17,0);gpio_hold_en(GPIO_NUM_17);}
 usb_event_pending=true;
}
bool start(const Work&w,const Command&c,uint32_t generation);
void wake_low_power_locked(){
 if(!low_power_mode.exchange(0))return;
 gpio_hold_dis(GPIO_NUM_17);gpio_set_level(GPIO_NUM_17,1);gpio_hold_en(GPIO_NUM_17);
 display_clear_fault();
 printf("NOTE4 POWER {\"mode\":\"active\"}\n");
 Work w;Command c;c.run_id="wake";
 if(recover_work(w)&&(w.kind!="runner"||(temperature_mc>=0&&temperature_mc<50000))){c.build_id=w.build_id;if(start(w,c,stop_generation))return;}
 sys_open=true;sys_cursor=0;sys_dirty=true;sys_enter=true;
}
void sys_draw(){display_tune(true,false);memset(frame,255,30000);std::string notice;{std::lock_guard<std::mutex> g(notice_mutex);notice=sys_notice;}if(!notice.empty()){auto cut=notice.find('\n');std::string a=notice.substr(0,cut),b=cut==std::string::npos?"":notice.substr(cut+1);sys_text((400-sys_width(a,2))/2,110,a,0,2);sys_text((400-sys_width(b))/2,170,b,0);return;}
 sys_text(16,8,"NOTE4 设置");std::string v=std::string("系统 ")+esp_app_get_description()->version;sys_text(384-sys_width(v),8,v,0);pixels(16,30,368,2,0);
 Work w;bool installed=recover_work(w);int y=38;auto row=[&](const char*k,const std::string&val){sys_text(16,y,k,0);sys_text(76,y,val);y+=22;};
 row("WiFi",network_ssid().empty()?"未设置":network_ssid());row("同步",sync_status());row("应用",installed?(app_title.empty()?"已安装":app_title):"还没有应用");
 {std::string st=std::to_string(temperature_mc/1000)+" C";if(battery_pct()>=0)st+=" · 电量 "+std::to_string(battery_pct())+"%";st+=voice_has_cred()?" · 语音已连":" · 语音未绑";row("状态",st);}
 pixels(16,130,368,1,0);{int ph=sync_phase.load(),pct=ph==1?20:ph==2?55:ph==5?85:0;if(pct)pixels(16,128,368*pct/100,4,0);}
 const std::string items[5]={installed?"返回打开应用":"暂无已安装应用","立即检查更新","自动同步："+sync_label(network_sync_minutes()),"待机休眠（关屏停网 · 保留 USB）","关机（断电池 · 插电自启 · 保 USB）"};
 for(int i=0;i<5;++i){int top=136+i*25;if(i==sys_cursor){pixels(16,top,368,23,0);sys_text(26,top+3,items[i],3);}else sys_text(26,top+3,items[i]);}
 pixels(16,266,368,1,0);sys_text(16,274,"上下选择    确认执行    长按上键返回",0);}
bool start(const Work&w,const Command&c,uint32_t generation){if(stop_generation!=generation)return false;sys_open=false;{std::lock_guard<std::mutex> g(notice_mutex);sys_notice.clear();}display_clear_fault();inputs=0;game_over=false;stop_latched=false;stop_reason=0;stop_dirty=true;active=w;active_motion=w.kind=="runner";display_tune(!active_motion,false);acoustic_allowed=(active_motion||w.kind=="js")&&w.allow_wave;if(w.kind=="js")js_reload=true;voice_agent_bind_work(w);current=c;state=initial(w.config);state.page=restore_reading(w);last_page=-1;last_choice=-1;reading_dirty=false;next_frame=0;stop_reason=0;emergency=false;running=true;deadline=esp_timer_get_time()+w.lease_ms*1000LL;audio_enable((w.kind=="runner"||w.kind=="js")&&w.allow_wave&&!derated);if(stop_generation!=generation){running=false;halt();return false;}return true;}
void runtime_receipt(const char*status,const char*detail){usb_event_pending=true;if(!current.command_id.empty())receipt(current,status,detail);else printf("NOTE4 LOCAL_RUN state=%s run_id=%s detail=%s\n",status,current.run_id.c_str(),detail);observed_changed();}
void runtime(void*){startup_ready(RUNTIME_MANAGER);TickType_t wake=xTaskGetTickCount();for(;;){xSemaphoreTake(lock,portMAX_DELAY);uint32_t tick_generation=stop_generation;auto bits=inputs.exchange(0);
 if(int lpr=lp_req.exchange(0);lpr!=0&&!ota_running){if(lpr==3)wake_low_power_locked();else enter_low_power_locked(lpr==2);xSemaphoreGive(lock);vTaskDelayUntil(&wake,pdMS_TO_TICKS(50));continue;}
 if(low_power_mode.load()!=0){if(bits&(1|256))wake_low_power_locked();xSemaphoreGive(lock);vTaskDelayUntil(&wake,pdMS_TO_TICKS(50));continue;}
 if(sys_toggle.exchange(false)&&!ota_running){if(sys_open){Work w;Command c;c.run_id="local";if(recover_work(w)&&(w.kind!="runner"||(temperature_mc>=0&&temperature_mc<50000))){c.build_id=w.build_id;start(w,c,stop_generation);}}else{if(running||game_over){halt(false);running=false;game_over=false;}sys_request=true;}}
 if(sys_request.exchange(false)&&!ota_running){sys_open=true;sys_cursor=0;sys_dirty=true;sys_enter=true;}
 if(!(running&&active.kind=="js"))js_app_stop();
 if(stop_dirty.exchange(false)){if(reading_dirty){save_reading(active,last_page);reading_dirty=false;}nvs_handle_t h;if(nvs_open("note4",NVS_READWRITE,&h)==ESP_OK){nvs_set_u8(h,"stopped",stop_latched?1:0);nvs_set_i64(h,"stop_cutoff",stop_cutoff);nvs_commit(h);nvs_close(h);}}
 if(running){
  if(display_fault()&&!emergency){stop_reason=5;running=false;halt();runtime_receipt("failed","display_driver_fault");}
  else if(emergency||bits&128||(active.kind=="runner"&&esp_timer_get_time()>deadline)){if(!emergency)stop_reason=(bits&128)?1:4;running=false;state.paused=true;halt();runtime_receipt("stopped","local_stop_or_lease");}
  else if(active.kind=="js"){if(js_reload.exchange(false))js_app_stop();if(!js_app_active()&&!js_app_load_file(active.path.c_str(),active.payload_offset,active.payload_size,active.app_id.c_str(),active.refresh_mode,active.frames,active.frame_bytes,active.frame_deflate)){running=false;halt();runtime_receipt("failed","js_load");sys_request=true;}else{if(bits&(512|1024|2048|4096))voice_agent_on_bits(bits);js_app_tick(bits);}}
  else if(active.kind=="runner"){
   bits=InputPolicy{active.allow_ok,active.allow_wave}.filter(bits);
   if(display_ready())step(state,bits,active.config);
   else inputs.fetch_or(bits); // Preserve the first press while the baseline is being built.
   auto now=esp_timer_get_time();
   if(!state.alive){render();running=false;game_over=true;inputs=0;audio_enable(active.allow_wave&&!derated);runtime_receipt("completed","collision");}
   else if(now>=next_frame){render();next_frame=now+(derated?200000:100000);}
  }else{if(display_busy()){inputs.fetch_or(bits);}else{if(active.kind=="reader")reader_step(state,bits,active.pages.size());else if(active.kind=="quiz")quiz_step(state,bits,active.questions);else card_step(state,bits,active.pages.size());if(state.page!=last_page||state.choice!=last_choice){if(read_page(active,state.page,page)){if(active.kind=="quiz")quiz_overlay(page,state,active.questions.size());bool submitted=false;if(active.kind=="quiz"){for(size_t i=0;i<30000;i++){unsigned packed=0;for(unsigned k=0;k<4;k++){unsigned px=i*4+k;unsigned gray=(px%2?page[px/2]&15:page[px/2]>>4);packed|=((gray+2)/5)<<(6-2*k);}frame[i]=packed;}submitted=display_frame(frame,30000);}else submitted=display_card(page,60000);if(submitted){last_page=state.page;last_choice=state.choice;usb_event_pending=true;if(active.kind=="reader"){reading_dirty=true;reading_dirty_at=esp_timer_get_time();}}}else{stop_reason=5;halt();running=false;runtime_receipt("failed","page_decode");}}}if(reading_dirty&&esp_timer_get_time()-reading_dirty_at>5000000){save_reading(active,last_page);reading_dirty=false;}}
 }else if(game_over){
  // A completed round retains only the selected retry sources, never a STOP override.
  if(emergency||bits&128||display_fault()||esp_timer_get_time()>deadline){if(bits&128)stop_reason=1;else if(display_fault())stop_reason=5;else if(esp_timer_get_time()>deadline)stop_reason=4;halt();state.paused=true;observed_changed();}
  else if(InputPolicy{active.allow_ok,active.allow_wave}.retry(bits)){
   if(temperature_mc>=0&&temperature_mc<50000){Command local;local.build_id=active.build_id;char id[40];snprintf(id,sizeof id,"local-%08lx-%08lx",(unsigned long)esp_random(),(unsigned long)esp_random());local.run_id=id;
    // Empty command_id: a physical retry is a new local run, NOT a new cloud command.
    if(start(active,local,tick_generation)){++retry_count;usb_event_pending=true;render();printf("NOTE4 LOCAL_RESTART run_id=%s\n",id);observed_changed();}
   }
  }
  if(game_over&&active.gesture_hud&&last_feedback!=gesture_feedback()&&esp_timer_get_time()>=next_frame){render();next_frame=esp_timer_get_time()+100000;}
 }
 if(sys_open&&!running){
  if(bits&2){sys_cursor=(sys_cursor+4)%5;sys_dirty=true;}
  if(bits&4){sys_cursor=(sys_cursor+1)%5;sys_dirty=true;}
  if(bits&(1|64)){
   sys_dirty=true;
   if(sys_cursor==0)sys_toggle=true;
   else if(sys_cursor==1)sync_requested=true;
   else if(sys_cursor==2){static const uint32_t steps[]={SYNC_ALWAYS,1,5,10,15,30,60,360,1440,0};uint32_t m=network_sync_minutes();size_t i=0;while(i<10&&steps[i]!=m)++i;network_set_sync_minutes(steps[(i+1)%10]);sync_changed=true;}
   else if(sys_cursor==3)enter_low_power_locked(false);
   else if(sys_cursor==4)enter_low_power_locked(true);
  }
  if(sys_enter.exchange(false)){display_clear_fault();}
  if(sys_open&&sys_dirty&&!display_busy()){sys_draw();if(display_frame(frame,30000))sys_dirty=false;}
 }
 xSemaphoreGive(lock);vTaskDelayUntil(&wake,pdMS_TO_TICKS(50));}}
void safety(void*){startup_ready(SAFETY_MANAGER);int64_t sampled=0;unsigned reports=0;for(;;){uint32_t bits=take_inputs();if(bits){++input_events;last_input=bits;}if(bits&256){sys_toggle=true;bits&=~256u;}if(bits&128){if(sys_open)bits&=~128u;else{stop_reason=1;halt();sys_request=true;}}inputs.fetch_or(bits);int64_t now=esp_timer_get_time();if(now-sampled>=1000000){sampled=now;load_meter.sample();power_status_sample();if(++reports>=30){reports=0;observed_changed();}float t=0;bool good=temp&&temperature_sensor_get_celsius(temp,&t)==ESP_OK;temperature_mc=good?int(t*1000):-127000;auto heap=esp_get_free_heap_size();if(heap<min_heap)min_heap=heap;if((running||game_over||ota_running)&&(!good||t>=55)){stop_reason=good?3:2;halt();}else if(good&&t>=50){derated=true;audio_enable(false);}else if(good&&t<=47&&derated.exchange(false)){if((running||game_over)&&acoustic_allowed&&!emergency)audio_enable(true);}}vTaskDelay(pdMS_TO_TICKS(20));}}
bool seen(const std::string&id,bool save){static std::mutex m;std::lock_guard<std::mutex> guard(m);nvs_handle_t h;if(nvs_open("commands",NVS_READWRITE,&h)!=ESP_OK)return true;char ids[16][97]{};size_t n=sizeof(ids);nvs_get_blob(h,"seen",ids,&n);for(auto&a:ids)if(id==a){nvs_close(h);return true;}if(save){memmove(ids+1,ids,15*97);snprintf(ids[0],97,"%s",id.c_str());nvs_set_blob(h,"seen",ids,sizeof(ids));nvs_commit(h);}nvs_close(h);return false;}
bool ota_cancelled(){return stop_generation!=ota_generation;}
void execute_impl(const Command&c){uint32_t generation=stop_generation;if(seen(c.command_id,false)){receipt(c,"duplicate","command_already_processed");return;}if(c.op=="stop"){if(c.scope=="audio"){audio_enable(false);receipt(c,"stopped","audio");return;}stop_reason=1;halt();xSemaphoreTake(lock,portMAX_DELAY);running=false;xSemaphoreGive(lock);if(c.scope=="app")display_home();receipt(c,"stopped",c.scope=="app"?"app_home":"device_run");return;}if(c.op!="install"&&stop_latched&&!c.local_authorized&&(stop_cutoff<0||c.created_at<=stop_cutoff)){receipt(c,"cancelled","command_predates_local_stop");return;}nvs_handle_t gate;char pending[97]={};size_t pending_n=sizeof(pending);if(nvs_open("note4",NVS_READWRITE,&gate)==ESP_OK){nvs_get_str(gate,"pending_command",pending,&pending_n);if(c.op!="install"&&stop_latched&&c.command_id==pending){nvs_close(gate);receipt(c,"cancelled","stopped_command_latched");return;}nvs_set_str(gate,"pending_command",c.command_id.c_str());nvs_commit(gate);nvs_close(gate);}if(c.op=="ota"){halt(false);xSemaphoreTake(lock,portMAX_DELAY);running=false;game_over=false;xSemaphoreGive(lock);ota_generation=stop_generation;ota_running=true;ota_execute(c,c.release_json,ota_cancelled);ota_running=false;observed_changed();return;}if(ota_boot_pending()){receipt(c,"failed","firmware_pending_confirmation");return;}if(activation_command()==c.command_id){receipt(c,"stopped","activated_before_restart_no_replay");return;}Work w;std::string e;if(c.op=="usb-install"){if(!validate_work("/data/staging.part",w,e)||w.build_id!=c.build_id){receipt(c,"failed","usb_stage_invalid");return;}}else if(c.op=="install"){receipt(c,"created","");receipt(c,"downloading","");if(!stage_download(c.artifact_url.c_str(),c.byte_length,device_token(),w,e)||w.build_id!=c.build_id){receipt(c,e=="cancelled"?"cancelled":"failed",e.empty()?"build_id_mismatch":e.c_str());return;}receipt(c,"verified","");receipt(c,"staged","");}else if(c.op=="run"){if(!recover_work(w)||w.build_id!=c.build_id){receipt(c,"failed","active_build_mismatch");return;}}else{receipt(c,"failed","unsupported_op");return;}
 if(stop_generation!=generation){receipt(c,"cancelled","local_stop_during_download");return;}
 if(w.kind=="runner"&&(temperature_mc<0||temperature_mc>=50000)){receipt(c,"failed","temperature_start_guard");return;}
 xSemaphoreTake(lock,portMAX_DELAY);bool old_running=running;Work old=active;State old_state=state;running=false;display_stop();audio_enable(false);receipt(c,"activating","");bool ok=(c.op=="install"||c.op=="usb-install")?activate_work(w,c.command_id,e):mark_run(c.command_id);if(ok)ok=recover_work(w);if(ok&&!c.title.empty()&&c.title.size()<64){app_title=c.title;nvs_handle_t tn;if(nvs_open("note4",NVS_READWRITE,&tn)==ESP_OK){nvs_set_str(tn,"title",c.title.c_str());nvs_commit(tn);nvs_close(tn);}}if(ok){if(start(w,c,generation))receipt(c,"running","");else receipt(c,"cancelled","stop_during_activation");}else{if(old_running&&stop_generation==generation&&!stop_latched){active=old;state=old_state;running=true;emergency=false;audio_enable(old.kind=="runner"&&old.allow_wave);}receipt(c,"failed",e.c_str());}xSemaphoreGive(lock);
}
void execute(const Command&);
// One sync: WiFi up, drain pending work and receipts, WiFi down. Bounded so a bad network cannot hold the radio on.
bool sync_once(bool always){static uint32_t windows=0;sync_phase=1;sys_dirty=true;if(!(always&&network_connected())&&!wifi_up(25000)){wifi_down();net_api_offline();sync_phase=3;sys_dirty=true;printf("NOTE4 SYNC wifi_failed\n");return false;}if(always&&++windows%60==0)network_recalibrate();sync_phase=2;sys_dirty=true;net_api_drain(always,true);int fails=0;bool good=false;for(int i=0;i<120;++i){Command c;if(next_command(c)&&mounted){sync_phase=5;sys_dirty=true;execute(c);sync_phase=2;continue;}ota_boot_poll(hello_accepted());if(network_round_ok()){fails=0;if(network_round_idle()&&!receipts_pending()&&!ota_boot_pending()){good=true;break;}}else if(++fails>=4)break;vTaskDelay(pdMS_TO_TICKS(2000));}net_api_drain(always,true);if(!always)wifi_down();if(good)last_sync_ok=esp_timer_get_time();sync_phase=good?0:4;sys_dirty=true;printf("NOTE4 SYNC %s\n",good?"ok":"server_failed");return good;}
// One Wi-Fi window does everything: sync with our server and send every queued app request.
// An app may open a window early, but never sooner than the chosen interval after the last one.
int64_t window_gap(uint32_t m){return (m==SYNC_ALWAYS||!m?1:m)*60000000LL;}
void net(void*){network_init();int64_t next_at=0,last_window=-3600000000LL;bool loaded=false,was_always=false;for(;;){if(low_power_mode.load()!=0){vTaskDelay(pdMS_TO_TICKS(250));continue;}if(setup_requested.exchange(false))wifi_setup_start();if(mounted&&!loaded){net_api_init();loaded=true;}if(loaded)net_api_save();int64_t now=esp_timer_get_time();bool manual=sync_requested.exchange(false);uint32_t m=network_sync_minutes();bool always=m==SYNC_ALWAYS,early=loaded&&!always&&now-last_window>=window_gap(m)&&net_api_wants(!m);if(network_configured()&&mounted&&!wifi_setup_active()&&!wifi_held()&&(manual||(next_at>=0&&now>=next_at)||early)){bool good=sync_once(always);m=network_sync_minutes();int64_t wait=window_gap(m);if(!good&&m)wait=std::min<int64_t>(wait,600000000LL);last_window=esp_timer_get_time();next_at=m?last_window+wait+esp_random()%(wait/20+1):-1;sync_changed=false;}else if(sync_changed.exchange(false)){m=network_sync_minutes();next_at=m?now+(m==SYNC_ALWAYS?0:window_gap(m)):-1;}always=m==SYNC_ALWAYS;if(was_always&&!always)wifi_down();was_always=always;if(always&&loaded&&network_connected()&&!wifi_setup_active())net_api_drain(true,false);network_service();ota_boot_poll(false);vTaskDelay(pdMS_TO_TICKS(200));}}
void execute(const Command&c){xSemaphoreTake(command_lock,portMAX_DELAY);execute_impl(c);xSemaphoreGive(command_lock);}
const char*str(cJSON*j,const char*k){auto*v=cJSON_GetObjectItem(j,k);return cJSON_IsString(v)?v->valuestring:"";}
void usb(void*){startup_ready(USB_MANAGER);char line[1536];size_t n=0;for(;;){char ch;int k=usb_serial_jtag_read_bytes(&ch,1,pdMS_TO_TICKS(100));if(k<=0){
if(usb_event_pending.exchange(false))printf("NOTE4 STATUS %s\n",runtime_snapshot().c_str());
if(CONFIG_NOTE4_USB_LAB_MODE||runtime_startup_failed())ota_boot_poll(false);
 continue;}if(ch!='\n'){if(n<sizeof(line)-1)line[n++]=ch;else n=0;continue;}line[n]=0;n=0;auto*j=cJSON_Parse(line);if(!j)continue;std::string op=str(j,"op");if(op=="stop"){stop_reason=1;halt();printf("NOTE4 {\"state\":\"stopped\",\"cpu_awake\":true}\n");}else if(op=="status"){printf("NOTE4 STATUS %s\n",runtime_snapshot().c_str());}else if(!runtime_local_ready()){printf("NOTE4 {\"error\":\"management_only\",\"startup_error\":\"%s\"}\n",startup_error.load());}else if(op=="js_probe"){xSemaphoreTake(lock,portMAX_DELAY);Work w;w.kind="js";w.allow_wave=true;w.lease_ms=3600000;Command c{};auto*probe_mode=cJSON_GetObjectItem(j,"refresh");bool ok=start(w,c,stop_generation)&&js_app_start(cJSON_IsNumber(probe_mode)?probe_mode->valueint:N4_DOTS);js_reload=false;if(!ok){running=false;halt();}xSemaphoreGive(lock);printf("NOTE4 USB {\"op\":\"js_probe\",\"ok\":%s}\n",ok?"true":"false");}else if(op=="js_key"){js_app_inject(str(j,"key"));printf("NOTE4 USB {\"op\":\"js_key\",\"ok\":true}\n");}else if(op=="usb_identity"){
 nvs_handle_t h;char token[65]{};size_t length=sizeof(token);bool ok=nvs_open("usb",NVS_READWRITE,&h)==ESP_OK;
 if(ok){if(nvs_get_str(h,"token",token,&length)!=ESP_OK){for(int i=0;i<8;++i)snprintf(token+8*i,9,"%08lx",(unsigned long)esp_random());ok=nvs_set_str(h,"token",token)==ESP_OK&&nvs_commit(h)==ESP_OK;}nvs_close(h);}
 if(ok){unsigned char digest[32];mbedtls_sha256((const unsigned char*)token,64,digest,0);char suffix[33]{};for(int i=0;i<16;++i)snprintf(suffix+2*i,3,"%02x",digest[i]);static uint32_t usb_boot=esp_random();printf("NOTE4 USB_ID {\"device_id\":\"usb-%s\",\"token\":\"%s\",\"boot_id\":\"%08lx\"}\n",suffix,token,(unsigned long)usb_boot);}else printf("NOTE4 {\"error\":\"usb_identity_storage\"}\n");
}else if(op=="test_retry"&&CONFIG_NOTE4_USB_LAB_MODE){
 const char* key=str(j,"key");unsigned bit=!strcmp(key,"ok")?1:!strcmp(key,"up")?2:!strcmp(key,"down")?4:!strcmp(key,"wave")?8:0;
 bool ok=bit&&game_over&&!stop_latched;if(ok)inputs.fetch_or(bit);
 printf("NOTE4 USB {\"op\":\"test_retry\",\"ok\":%s,\"source\":\"synthetic_logical_input\"}\n",ok?"true":"false");
 }else if((op=="work_begin"||op=="work_chunk"||op=="work_commit")&&!CONFIG_NOTE4_USB_LAB_MODE&&!CONFIG_NOTE4_USB_TRANSPORT){printf("NOTE4 {\"error\":\"usb_lab_profile_required\"}\n");}else if(op=="work_begin"||op=="work_chunk"||op=="work_commit"){
 std::string error;bool ok=false;
 if(op=="work_begin"){auto*v=cJSON_GetObjectItem(j,"byte_length");ok=cJSON_IsNumber(v)&&usb_work_begin(v->valueint,str(j,"sha256"),error);}
 if(op=="work_chunk"){auto*v=cJSON_GetObjectItem(j,"offset");ok=cJSON_IsNumber(v)&&usb_work_chunk(v->valueint,str(j,"data"),error);}
 if(op=="work_commit"){Work w;ok=usb_work_finish(w,error);if(ok){if(low_power_mode.load()!=0){xSemaphoreTake(lock,portMAX_DELAY);wake_low_power_locked();xSemaphoreGive(lock);}Command c;c.command_id=str(j,"command_id");c.run_id=c.command_id;c.build_id=w.build_id;c.op="usb-install";c.local_authorized=true;if(c.command_id.empty()){ok=false;error="command_id_required";}else execute(c);}}
 printf("NOTE4 USB {\"op\":\"%s\",\"ok\":%s,\"offset\":%u,\"error\":\"%s\"}\n",op.c_str(),ok?"true":"false",unsigned(usb_work_offset()),error.c_str());
 }else if(op=="wifi_setup"){halt();printf("NOTE4 {\"wifi_setup\":%s}\n",wifi_setup_start()?"true":"false");}else if(op=="wifi_setup_stop"){wifi_setup_stop();printf("NOTE4 {\"wifi_setup\":false}\n");}else if(op=="enroll"){bool ok=provision_enrollment(str(j,"base_url"),str(j,"device_id"),str(j,"enrollment_code"));printf("NOTE4 {\"enrollment_prepared\":%s,\"restart_required\":true}\n",ok?"true":"false");}else if(op=="provision"){auto*sm=cJSON_GetObjectItem(j,"sync_minutes");bool ok=provision(str(j,"ssid"),str(j,"password"),str(j,"base_url"),str(j,"device_token"),str(j,"device_id"),cJSON_IsNumber(sm)?sm->valueint:-1);printf("NOTE4 {\"provisioned\":%s,\"restart_required\":%s}\n",ok?"true":"false",ok?"true":"false");fflush(stdout);if(ok){vTaskDelay(pdMS_TO_TICKS(500));esp_restart();}}else if(op=="set_sync"){auto*sm=cJSON_GetObjectItem(j,"sync_minutes");if(cJSON_IsNumber(sm)){network_set_sync_minutes(sm->valueint);sync_changed=true;sys_dirty=true;}printf("NOTE4 {\"sync_minutes\":%lu}\n",(unsigned long)network_sync_minutes());}else if(op=="sync"){sync_requested=true;printf("NOTE4 {\"sync_requested\":true}\n");}else if(op=="notice"){{std::lock_guard<std::mutex> g(notice_mutex);sys_notice=std::string(str(j,"text")).substr(0,120);}halt(false);sys_request=true;printf("NOTE4 {\"notice\":true}\n");}else if(op=="nfc_restore"){printf("NOTE4 {\"nfc_restored\":%s}\n",nfc_restore_userdata()?"true":"false");}else if(op=="nfc_url"){bool ok=nfc_write_url(str(j,"url"));printf("NOTE4 {\"nfc_written\":%s}\n",ok?"true":"false");}else if(op=="set_ai_cred"){auto*clr=cJSON_GetObjectItem(j,"clear");auto*rv=cJSON_GetObjectItem(j,"rev");int64_t rev=cJSON_IsNumber(rv)?(int64_t)rv->valuedouble:0;bool ok=cJSON_IsTrue(clr)?voice_clear_cred(rev):voice_set_cred(str(j,"kind"),str(j,"token"),str(j,"base_url"),str(j,"model"),rev);sys_dirty=true;printf("NOTE4 USB {\"op\":\"set_ai_cred\",\"ok\":%s,\"kind\":\"%s\"}\n",ok?"true":"false",voice_cred_kind());}else if(op=="voice_sim"){bool ok=voice_sim_utterance(str(j,"text"));printf("NOTE4 USB {\"op\":\"voice_sim\",\"ok\":%s}\n",ok?"true":"false");}else if(op=="voice_mock"){voice_set_mock(cJSON_IsTrue(cJSON_GetObjectItem(j,"enabled")),str(j,"text"));printf("NOTE4 USB {\"op\":\"voice_mock\",\"ok\":true}\n");}else if(op=="voice_diag"){auto*dm=cJSON_GetObjectItem(j,"ms");std::string r=voice_usb_diag(str(j,"action"),cJSON_IsNumber(dm)?dm->valueint:0);printf("NOTE4 USB %s\n",r.c_str());}else if(op=="standby"){lp_req=1;printf("NOTE4 USB {\"op\":\"standby\",\"ok\":true}\n");}else if(op=="power_off"){lp_req=2;printf("NOTE4 USB {\"op\":\"power_off\",\"ok\":true}\n");}else if(op=="wake"){lp_req=3;printf("NOTE4 USB {\"op\":\"wake\",\"ok\":true}\n");}else if(op=="run"){if(low_power_mode.load()!=0){xSemaphoreTake(lock,portMAX_DELAY);wake_low_power_locked();xSemaphoreGive(lock);}Command c;c.command_id=str(j,"command_id");c.build_id=str(j,"build_id");c.run_id=str(j,"run_id");c.op="run";c.local_authorized=true;if(!c.command_id.empty())execute(c);}else printf("NOTE4 {\"error\":\"unsupported_op\"}\n");cJSON_Delete(j);}}
}
void accept_server_time(int64_t t){if(t>1600000000000LL&&stop_latched&&stop_cutoff<0){stop_cutoff=t;stop_dirty=true;}}
uint32_t cancellation_generation(){return stop_generation;}bool runtime_stop_latched(){return stop_latched;}bool runtime_high_load(){return running&&active_motion;}bool runtime_derated(){return derated;}void request_setup(){halt();setup_requested=true;}bool runtime_local_ready(){return startup_health.managers_ready()&&nvs_ok&&mounted&&lock&&command_lock&&frame&&page&&temp&&temperature_mc>=0;}
void runtime_status_changed(){usb_event_pending=true;}
std::string runtime_snapshot(){if(lock)xSemaphoreTake(lock,portMAX_DELAY);auto*j=cJSON_CreateObject();cJSON_AddStringToObject(j,"build_id",active.build_id.c_str());cJSON_AddStringToObject(j,"run_id",current.run_id.c_str());cJSON_AddStringToObject(j,"state",running?protocol::runtime_states[0]:game_over?protocol::runtime_states[2]:protocol::runtime_states[1]);cJSON_AddNumberToObject(j,"tick",state.tick);cJSON_AddNumberToObject(j,"interactive_abi",2);cJSON_AddNumberToObject(j,"page",state.page);cJSON_AddNumberToObject(j,"choice",state.choice);cJSON_AddNumberToObject(j,"score",state.score);cJSON_AddNumberToObject(j,"temperature_mc",temperature_mc);cJSON_AddNumberToObject(j,"cpu_total_pct",load_meter.total.load()/10.0);cJSON_AddNumberToObject(j,"cpu_display_pct_one_core",load_meter.display.load()/10.0);cJSON_AddNumberToObject(j,"cpu_audio_pct_one_core",load_meter.audio.load()/10.0);cJSON_AddNumberToObject(j,"cpu_runtime_pct_one_core",load_meter.runtime.load()/10.0);cJSON_AddBoolToObject(j,"derated",derated);cJSON_AddBoolToObject(j,"stop_latched",stop_latched);cJSON_AddNumberToObject(j,"heap_free",esp_get_free_heap_size());cJSON_AddNumberToObject(j,"heap_min",min_heap);cJSON_AddNumberToObject(j,"reporter_stack_words",uxTaskGetStackHighWaterMark(nullptr));cJSON_AddNumberToObject(j,"display_dropped",display_dropped());cJSON_AddNumberToObject(j,"display_submitted",display_submitted());cJSON_AddNumberToObject(j,"display_scans",display_scans());cJSON_AddNumberToObject(j,"display_scan_us",display_scan_us());cJSON_AddBoolToObject(j,"display_ready",display_ready());cJSON_AddBoolToObject(j,"display_drive_active",display_drive_active());cJSON_AddBoolToObject(j,"audio_active",audio_ready());cJSON_AddNumberToObject(j,"amp_gpio46",gpio_get_level(GPIO_NUM_46));cJSON_AddNumberToObject(j,"shared_rail42",gpio_get_level(GPIO_NUM_42));cJSON_AddStringToObject(j,"input_mode",InputPolicy{active.allow_ok,active.allow_wave}.name());cJSON_AddStringToObject(j,"gesture_feedback",gesture_feedback());cJSON_AddBoolToObject(j,"game_over",game_over);cJSON_AddNumberToObject(j,"input_events",input_events);cJSON_AddNumberToObject(j,"last_input",last_input);cJSON_AddNumberToObject(j,"retries",retry_count);cJSON_AddNumberToObject(j,"receipt_dropped",network_dropped());cJSON_AddBoolToObject(j,"ota_active",ota_running);cJSON_AddNumberToObject(j,"panel_gpio6",panel_power_readback());cJSON_AddNumberToObject(j,"panel_blocked_writes",panel_blocked_writes());cJSON_AddNumberToObject(j,"stop_reason",stop_reason);const char* reasons[]={"none","user_stop","temperature_sensor","temperature_limit","lease_expired","display_fault"};int reason=stop_reason;cJSON_AddStringToObject(j,"stop_reason_text",reason>=0&&reason<6?reasons[reason]:"unknown");cJSON_AddStringToObject(j,"firmware",esp_app_get_description()->version);cJSON_AddStringToObject(j,"startup_error",startup_error.load());cJSON_AddBoolToObject(j,"startup_ready",runtime_local_ready());cJSON_AddNumberToObject(j,"manager_mask",startup_health.ready);cJSON_AddBoolToObject(j,"nvs_ready",nvs_ok);cJSON_AddBoolToObject(j,"storage_ready",mounted);cJSON_AddBoolToObject(j,"usb_only",CONFIG_NOTE4_USB_LAB_MODE);cJSON_AddNumberToObject(j,"sync_minutes",network_sync_minutes());cJSON_AddBoolToObject(j,"wifi_configured",network_configured());cJSON_AddNumberToObject(j,"wifi_error",sync_phase.load()==3?network_wifi_reason():0);cJSON_AddBoolToObject(j,"nfc_ready",nfc_ready());cJSON_AddStringToObject(j,"led_mode",led_mode_name());cJSON_AddStringToObject(j,"voice_phase",voice_phase_name());cJSON_AddStringToObject(j,"ai_cred_kind",voice_cred_kind());cJSON_AddNumberToObject(j,"ai_cred_rev",(double)voice_cred_rev());cJSON_AddNumberToObject(j,"battery_mv",battery_mv());cJSON_AddNumberToObject(j,"battery_pct",battery_pct());cJSON_AddStringToObject(j,"charge_state",charge_state_name());int lpm=low_power_mode.load();cJSON_AddStringToObject(j,"power_mode",lpm==2?"power_off_usb":lpm==1?"standby":"active");if(lock)xSemaphoreGive(lock);char*p=cJSON_PrintUnformatted(j);std::string result=p?p:"{}";cJSON_free(p);cJSON_Delete(j);return result;}
void startup_ready(Manager m){startup_health.ready.fetch_or(m);}
void startup_failed(const char*error){startup_error=error;startup_health.failed=true;panel_emergency_cut();audio_enable(false);printf("NOTE4 STARTUP_FAILED %s USB_MANAGEMENT_RETAINED\n",error);}
bool runtime_startup_failed(){return startup_health.failed;}
void record_terminal(const std::string&id){if(!id.empty())seen(id,true);}
}
extern "C" void app_main(){using namespace note4;
 // Keep the board and USB manager alive before storage or optional peripherals.
 gpio_config_t g{};g.pin_bit_mask=(1ULL<<17)|(1ULL<<6)|(1ULL<<42)|(1ULL<<46);g.mode=GPIO_MODE_INPUT_OUTPUT;gpio_config(&g);
 gpio_hold_dis(GPIO_NUM_17);gpio_set_level(GPIO_NUM_17,1);
 for(auto pin:{GPIO_NUM_6,GPIO_NUM_42,GPIO_NUM_46}){gpio_hold_dis(pin);gpio_set_level(pin,0);gpio_hold_en(pin);}
 // Dynamic Frequency Scaling: 80MHz cool idle -> 240MHz on-demand boost, no light-sleep so USB JTAG never drops!
 esp_pm_config_t pm{};pm.max_freq_mhz=240;pm.min_freq_mhz=80;pm.light_sleep_enable=false;esp_pm_configure(&pm);
 usb_serial_jtag_driver_config_t u{};u.tx_buffer_size=4096;u.rx_buffer_size=2048;
 if(usb_serial_jtag_driver_install(&u)!=ESP_OK){printf("NOTE4 USB_DRIVER_FAILED loads_disabled\n");return;}
 // Route console output through the installed buffered driver too. Mixing
 // direct FIFO printf with interrupt-driven RX can leave a 64-byte ACK pending.
 usb_serial_jtag_vfs_use_driver();
 lock=xSemaphoreCreateMutex();command_lock=xSemaphoreCreateMutex();
 if(xTaskCreate(usb,"usb_debug",10240,nullptr,3,nullptr)!=pdPASS){startup_failed("usb_task_create");usb(nullptr);return;}
 if(!lock||!command_lock){startup_failed("mutex_create");return;}
 esp_err_t nvs_result=nvs_flash_init();
#if CONFIG_NOTE4_TEST_NVS_INIT_FAIL
 nvs_result=ESP_ERR_NVS_NO_FREE_PAGES; // Lab fault only; never erases NVS.
#endif
 nvs_ok=nvs_result==ESP_OK;
 if(!nvs_ok){startup_failed("nvs_initialization");ota_boot_begin();return;}
 mounted=store_init();if(!mounted){startup_failed("work_storage_mount");ota_boot_begin();return;}
 frame=(uint8_t*)heap_caps_malloc(30000,MALLOC_CAP_SPIRAM);page=(uint8_t*)heap_caps_malloc(60000,MALLOC_CAP_SPIRAM);
 if(!frame||!page||!js_fonts_init()){startup_failed("frame_or_font_allocation");ota_boot_begin();return;}
 peripherals_init();if(!display_init()){startup_failed("display_initialization");ota_boot_begin();return;}
 voice_agent_init(lock);
 temperature_sensor_config_t t=TEMPERATURE_SENSOR_CONFIG_DEFAULT(10,80);
 if(temperature_sensor_install(&t,&temp)!=ESP_OK||temperature_sensor_enable(temp)!=ESP_OK){startup_failed("temperature_initialization");ota_boot_begin();return;}
 nvs_handle_t restored;if(nvs_open("note4",NVS_READONLY,&restored)==ESP_OK){uint8_t stopped=0;nvs_get_u8(restored,"stopped",&stopped);stop_latched=stopped;int64_t cutoff=stopped?-1:0;nvs_get_i64(restored,"stop_cutoff",&cutoff);stop_cutoff=cutoff;nvs_close(restored);}
 if(xTaskCreate(runtime,"local_runner",12288,nullptr,3,nullptr)!=pdPASS)startup_failed("runtime_task_create");
 if(xTaskCreate(safety,"stop_safety",4096,nullptr,8,nullptr)!=pdPASS)startup_failed("safety_task_create");
 ota_boot_begin();
#if !CONFIG_NOTE4_USB_LAB_MODE
 if(!runtime_startup_failed()&&xTaskCreate(net,"cloud",12288,nullptr,2,nullptr)!=pdPASS)startup_failed("network_task_create");
 {nvs_handle_t tn;if(nvs_open("note4",NVS_READONLY,&tn)==ESP_OK){char t[64]{};size_t n=sizeof t;if(nvs_get_str(tn,"title",t,&n)==ESP_OK)app_title=t;nvs_close(tn);}}
 // After any reboot or flash the screen shows the installed app, or the system page.
 {bool resumed=false;xSemaphoreTake(lock,portMAX_DELAY);Work boot_work;if(!runtime_startup_failed()&&!ota_boot_pending()&&!stop_latched&&recover_work(boot_work)&&boot_work.kind!="runner"){Command c;c.run_id="boot";c.build_id=boot_work.build_id;resumed=start(boot_work,c,stop_generation.load());}xSemaphoreGive(lock);if(!resumed&&!runtime_startup_failed())sys_request=true;}
#endif
 startup_error=runtime_startup_failed()?startup_error.load():"none";
 printf("NOTE4 MANAGERS_STARTED usb_only=%d\n",CONFIG_NOTE4_USB_LAB_MODE);
}
