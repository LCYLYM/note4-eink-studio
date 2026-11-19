#include "peripherals.hpp"
#include "startup.hpp"
#include "runtime_control.hpp"
#include <atomic>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <cstdio>
#include <unistd.h>
#include <sys/stat.h>
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "gesture_audio.hpp"
#include "gesture_detector.hpp"
#include "zectrix_nfc.h"
#include "i2c_bus_lock.h"

// The board shares GPIO42 between codec power and the NFC I2C supply.
extern "C" void BoardI2cForcePowerOn() {
 gpio_hold_dis(GPIO_NUM_42);gpio_set_level(GPIO_NUM_42,1);gpio_hold_en(GPIO_NUM_42);
}
namespace note4 { namespace {
std::atomic<uint32_t> inputs{0};std::atomic<int> feedback{0};std::atomic<int64_t> feedback_at{0};
std::atomic<bool> wanted{false},nfc_ok{false},audio_ok{false},bus_ok{false};
portMUX_TYPE pa_guard=portMUX_INITIALIZER_UNLOCKED;
i2c_master_bus_handle_t bus=nullptr;
ZectrixNfc* nfc=nullptr;
constexpr char TAG[]="note4_inputs";
void rail(gpio_num_t pin, int level) { gpio_hold_dis(pin); gpio_set_level(pin,level); gpio_hold_en(pin); }
void fault(const char* why) { audio_enable(false); inputs.fetch_or(128); ESP_LOGE(TAG,"audio stopped: %s",why); }
void buttons(void*) {
 startup_ready(BUTTON_MANAGER);
 struct Button { gpio_num_t pin; uint32_t bit; bool raw=false,stable=false,long_sent=false; int64_t changed=0,pressed=0; };
 Button keys[]={{GPIO_NUM_0,1},{GPIO_NUM_39,2},{GPIO_NUM_18,4}};
 for(;;) {
  const int64_t now=esp_timer_get_time()/1000;
  for(auto& b:keys) {
   const bool down=!gpio_get_level(b.pin);
   if(down!=b.raw) { b.raw=down; b.changed=now; }
   if(now-b.changed>=30 && b.stable!=b.raw) {
    b.stable=b.raw;
    if(b.stable) { b.pressed=now; b.long_sent=false; }
    else if(!b.long_sent) inputs.fetch_or(b.bit);
   }
   if(b.stable && !b.long_sent && now-b.pressed>=(b.pin==GPIO_NUM_39?2000:800)) {
    b.long_sent=true; audio_enable(false); inputs.fetch_or(b.pin==GPIO_NUM_39?256:128);
   }
  }
  vTaskDelay(pdMS_TO_TICKS(10));
 }
}
void audio_worker(void*) {
 ugl::AudioCapture audio; ugl::Detector detector;
 bool active=false; float phase=0; constexpr float tau=6.283185307179586f,step=tau*21500.f/48000.f;
 int16_t pilot[240],samples[2048]; size_t filled=0; uint32_t overruns=0;
 for(;;) {
  if(!wanted) {
   if(active || audio.initialized()) { rail(GPIO_NUM_46,0); audio.Shutdown(); active=false;audio_ok=false;runtime_status_changed(); }
   vTaskDelay(pdMS_TO_TICKS(100)); continue;
  }
  if(!active) {
   rail(GPIO_NUM_42,1); vTaskDelay(pdMS_TO_TICKS(20));
   esp_err_t err=audio.Init({},bus);
   if(err==ESP_OK && wanted) err=audio.Start();
   if(err!=ESP_OK || !wanted) { if(wanted)fault(esp_err_to_name(err)); audio.Shutdown(); continue; }
   active=true;audio_ok=true;runtime_status_changed(); filled=0; phase=0; overruns=audio.Overruns(); detector.Reset();
   // Prime I2S before enabling PA; physical amplitude remains the reference 0.08.
  }
  size_t count=std::min<size_t>(240,2048-filled);
  for(size_t i=0;i<count;++i) { pilot[i]=int16_t(std::sin(phase)*32767.f*0.08f); phase+=step; if(phase>=tau)phase-=tau; }
  if(audio.Write(pilot,count)!=int(count)) { fault("write"); continue; }
  portENTER_CRITICAL(&pa_guard);if(wanted) rail(GPIO_NUM_46,1);portEXIT_CRITICAL(&pa_guard);
  if(audio.Read(samples+filled,count)!=int(count)) { fault("read"); continue; }
  filled+=count;
  if(filled==2048) {
   ugl::DetectionStats stats; uint32_t next=audio.Overruns();
   auto event=detector.Process(samples,filled,next-overruns,&stats); overruns=next; filled=0;
   if(!wanted)continue;
   if(event.type!=ugl::EventType::kIdle){feedback=int(event.type);feedback_at=esp_timer_get_time();}
   switch(event.type) {
    case ugl::EventType::kWave: inputs.fetch_or(8);break;
    case ugl::EventType::kApproach: inputs.fetch_or(16);break;
    case ugl::EventType::kRetreat: inputs.fetch_or(32);break;
    default:break;
   }
  }
 }
}
}
void audio_enable(bool enabled) { portENTER_CRITICAL(&pa_guard);wanted=enabled; if(!enabled) rail(GPIO_NUM_46,0);portEXIT_CRITICAL(&pa_guard); }
bool nfc_ready(){return nfc_ok;}bool audio_ready(){return audio_ok;}bool input_bus_ready(){return bus_ok;}
uint32_t take_inputs() { return inputs.exchange(0); }
const char* gesture_feedback(){
 if(!wanted)return "US:OFF";
 if(!audio_ok)return "US:START";
 if(esp_timer_get_time()-feedback_at.load()>450000)return "US:IDLE";
 switch(ugl::EventType(feedback.load())){case ugl::EventType::kWave:return "US:WAVE";case ugl::EventType::kApproach:return "US:NEAR";case ugl::EventType::kRetreat:return "US:AWAY";case ugl::EventType::kInvalid:return "US:INVALID";default:return "US:IDLE";}
}
void peripherals_init() {
 gpio_config_t outputs{};outputs.pin_bit_mask=(1ULL<<42)|(1ULL<<46);outputs.mode=GPIO_MODE_OUTPUT;
 ESP_ERROR_CHECK(gpio_config(&outputs));rail(GPIO_NUM_46,0);rail(GPIO_NUM_42,1);
 gpio_config_t cfg{};cfg.pin_bit_mask=(1ULL<<0)|(1ULL<<39)|(1ULL<<18);cfg.mode=GPIO_MODE_INPUT;cfg.pull_up_en=GPIO_PULLUP_ENABLE;
 ESP_ERROR_CHECK(gpio_config(&cfg));
 // Physical input stop remains available even if peripheral bus initialization fails.
 if(xTaskCreate(buttons,"note4_buttons",3072,nullptr,8,nullptr)!=pdPASS){startup_failed("button_task_create");return;}
 i2c_master_bus_config_t i2c{};i2c.i2c_port=I2C_NUM_0;i2c.sda_io_num=GPIO_NUM_47;i2c.scl_io_num=GPIO_NUM_48;
 i2c.clk_source=I2C_CLK_SRC_DEFAULT;i2c.glitch_ignore_cnt=7;i2c.flags.enable_internal_pullup=1;
 if(i2c_new_master_bus(&i2c,&bus)!=ESP_OK) { ESP_LOGE(TAG,"I2C unavailable; buttons remain live");return; }
 bus_ok=true;nfc=new ZectrixNfc(bus,0x55,GPIO_NUM_21,GPIO_NUM_7,0);
 if(nfc->Init()){nfc_ok=true;nfc->SetFieldCallback([](bool present){if(present)inputs.fetch_or(64);});}
 else ESP_LOGW(TAG,"NFC init failed; no NFC writes attempted");
 if(xTaskCreate(audio_worker,"note4_audio",14336,nullptr,5,nullptr)!=pdPASS)startup_failed("audio_task_create");
}
bool nfc_write_url(const char* url) {
 if(!nfc || !url || std::strncmp(url,"https://",8)!=0 || std::strlen(url)>300 || std::strchr(url,'\n'))return false;
 // This URL is public navigation only. Never put a device credential in it.
 if(std::strstr(url,"token=") || std::strstr(url,"secret="))return false;
 ScopedI2cBusLock lock("note4_nfc_commission");if(!lock.locked() || nfc->HasField())return false;
 uint8_t backup[ZectrixNfc::kUserDataCapacity];
 struct stat st{};
 if(stat("/data/nfc-backup.bin",&st)!=0) {
  if(nfc->ReadUserData(0,backup,sizeof(backup))!=ESP_OK)return false;
  FILE* file=std::fopen("/data/nfc-backup.tmp","wb");if(!file)return false;
  bool ok=std::fwrite(backup,1,sizeof(backup),file)==sizeof(backup);
  ok=std::fflush(file)==0 && ok;ok=fsync(fileno(file))==0 && ok;ok=std::fclose(file)==0 && ok;
  if(!ok || std::rename("/data/nfc-backup.tmp","/data/nfc-backup.bin")!=0)return false;
 } else if(st.st_size!=sizeof(backup))return false;
 return nfc->WriteUriNdef(url)==ESP_OK;
}
bool nfc_restore_userdata() {
 if(!nfc || nfc->HasField())return false;
 uint8_t backup[ZectrixNfc::kUserDataCapacity];
 FILE* file=std::fopen("/data/nfc-backup.bin","rb");if(!file)return false;
 size_t got=std::fread(backup,1,sizeof(backup),file);int extra=std::fgetc(file);std::fclose(file);
 if(got!=sizeof(backup) || extra!=EOF)return false;
 ScopedI2cBusLock lock("note4_nfc_restore");if(!lock.locked() || nfc->HasField())return false;
 return nfc->WriteUserData(0,backup,sizeof(backup))==ESP_OK;
}

}
