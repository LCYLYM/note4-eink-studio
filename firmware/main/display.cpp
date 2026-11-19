#include "display.hpp"
#include "startup.hpp"
#include "power_guard.hpp"
#include "runtime_control.hpp"
#include "zectrix_ascii_font_8x16.h"
#include <string>
#include "full_resolution_plan.hpp"
#include "factory_stage.hpp"
#include "zectrix_epd.h"
#include "driver/spi_master.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include <atomic>
#include <cstring>
#include <algorithm>
namespace note4 { namespace {
constexpr size_t N=30000;
std::atomic<bool> still{true},tuned{false};
std::atomic<bool> stop{false},busy{false},quiesced{true},fault{false};
SemaphoreHandle_t mutex;TaskHandle_t display_task=nullptr;std::string message_pending,message_active;std::atomic<uint32_t> frames_dropped{0},scans{0},scan_us{0},submitted{0};
uint8_t *pending,*frame,*mask,*previous,*card,*card_pending,*white;
motion::HistoryPixel* pixels;motion::Excursion* history;
int request=0;bool newframe=false;
spi_device_handle_t spi=nullptr;zectrix_epd_handle_t official=nullptr;
bool rail=false;std::atomic<bool> analog{false},valid{false};
int64_t now(){return esp_timer_get_time();}
bool transfer(bool data,const uint8_t* b,size_t n){gpio_set_level(GPIO_NUM_10,data);gpio_set_level(GPIO_NUM_11,0);while(n){size_t k=std::min(n,size_t(4096));spi_transaction_t t{};t.length=k*8;t.tx_buffer=b;if(spi_device_transmit(spi,&t)!=ESP_OK){gpio_set_level(GPIO_NUM_11,1);return false;}b+=k;n-=k;}gpio_set_level(GPIO_NUM_11,1);return true;}
bool reg(uint8_t c,const uint8_t*b=nullptr,size_t n=0){return transfer(false,&c,1)&&(!n||transfer(true,b,n));}
bool byte(uint8_t c,uint8_t d){return reg(c,&d,1);}
bool wait_busy(unsigned pre=0){int64_t t=now();if(pre)vTaskDelay(pdMS_TO_TICKS(pre));while(!gpio_get_level(GPIO_NUM_8)){if(stop||now()-t>5000000)return false;vTaskDelay(1);}return !stop;}
void release(){valid=false;if(spi){if(rail&&analog&&!stop&&gpio_get_level(GPIO_NUM_8)){byte(2,0);wait_busy(10);}gpio_hold_dis(GPIO_NUM_6);gpio_set_level(GPIO_NUM_6,0);gpio_hold_en(GPIO_NUM_6);rail=analog=false;spi_bus_remove_device(spi);spi=nullptr;spi_bus_free(SPI3_HOST);}if(official){zectrix_epd_del(official);official=nullptr;}}
bool create_official(){release();zectrix_epd_config_t c;zectrix_epd_get_default_config(&c);return zectrix_epd_new(&c,&official)==ESP_OK;}
bool baseline(bool black){if(!create_official())return false;memset(white,black?0:255,15000);bool ok=zectrix_epd_power_on(official)==ESP_OK&&!stop&&zectrix_epd_refresh_full_1bpp(official,white,15000)==ESP_OK;zectrix_epd_power_off(official);release();return ok&&!stop;}
bool custom_init(){
 spi_bus_config_t b{};b.mosi_io_num=13;b.miso_io_num=-1;b.sclk_io_num=12;b.quadwp_io_num=-1;b.quadhd_io_num=-1;b.max_transfer_sz=4096;
 if(spi_bus_initialize(SPI3_HOST,&b,SPI_DMA_CH_AUTO)!=ESP_OK)return false;
 spi_device_interface_config_t d{};d.clock_speed_hz=20000000;d.spics_io_num=-1;d.queue_size=1;if(spi_bus_add_device(SPI3_HOST,&d,&spi)!=ESP_OK){spi_bus_free(SPI3_HOST);return false;}
 if(stop||panel_locked()){return false;}gpio_hold_dis(GPIO_NUM_6);gpio_set_level(GPIO_NUM_6,1);gpio_hold_en(GPIO_NUM_6);if(stop||panel_locked()){return false;}rail=true;gpio_set_level(GPIO_NUM_9,1);vTaskDelay(pdMS_TO_TICKS(10));gpio_set_level(GPIO_NUM_9,0);vTaskDelay(pdMS_TO_TICKS(20));gpio_set_level(GPIO_NUM_9,1);vTaskDelay(pdMS_TO_TICKS(10));
 const uint8_t psr[]={0x2f,0x0e},boost[]={0x0f,0x8b,0x9c,0xaa},res[]={1,0x90,1,0x2c},zero[]={0,0,0,0},gs[]={0x64,0x53};
 if(!(wait_busy()&&reg(0,psr,2)&&reg(6,boost,4)&&byte(0xe7,0x98)&&byte(0x30,8)&&byte(0x50,0x77)&&reg(0x62,gs,2)&&reg(0x61,res,4)&&reg(0x65,zero,4)&&byte(0xe9,1)&&wait_busy(10)))return false;
 const uint8_t* lut=motion::endpoint_unit.data();const uint8_t p[]={0x2f,0xe8},power[]={7,lut[0],lut[1],lut[2],lut[3],lut[4]},boost2[]={0,0x8b,0x9c,0xaa};
 if(!(reg(0,p,2)&&reg(1,power,6)&&byte(0x30,lut[6])&&byte(0x82,lut[5])&&reg(0x61,res,4)&&reg(0x65,zero,4)&&reg(0x20,lut,535)&&reg(6,boost2,4)&&wait_busy()))return false;
 analog=true;return reg(4)&&wait_busy(10)&&byte(0x30,7);
}
bool scan(){auto t=now();if(!analog){if(stop||!reg(4)||!wait_busy(10))return false;analog=true;}
 bool ok=!stop&&wait_busy()&&reg(0x10,mask,N)&&byte(0x12,0)&&wait_busy(10);if(ok){scan_us=now()-t;++scans;}return ok;}
bool home(){if(!create_official())return false;memset(white,255,15000);int x=16,y=16;
 for(unsigned char ch:message_active){if(ch=='\n'){x=16;y+=24;continue;}if(ch<32||ch>126)ch='?';int index=ch-32;int width=kZectrixAsciiFontWidths[index];if(x+width>=384){x=16;y+=24;}if(y+16>=292)break;for(int yy=0;yy<16;++yy)for(int xx=0;xx<width;++xx)if(kZectrixAsciiFont8x16[index][yy]&(0x8000>>xx)){int px=x+xx,py=y+yy;white[(py*400+px)/8]&=~(128>>(px%8));}x+=width+1;}
 bool ok=!stop&&zectrix_epd_power_on(official)==ESP_OK&&!stop&&zectrix_epd_refresh_full_1bpp(official,white,15000)==ESP_OK;release();return ok;}
void task(void*){startup_ready(DISPLAY_MANAGER);
 motion::FullResolutionPlan plan{{pixels,history,100,300},N,previous};bool budget=false;int64_t last_drive=0;
 for(;;){
  if(stop){bool changed=!quiesced;release();xSemaphoreTake(mutex,portMAX_DELAY);request=0;newframe=false;xSemaphoreGive(mutex);quiesced=true;busy=false;budget=false;if(changed)runtime_status_changed();ulTaskNotifyTake(pdTRUE,pdMS_TO_TICKS(1000));continue;}
  int work;bool changed; xSemaphoreTake(mutex,portMAX_DELAY);work=request;request=0;changed=newframe;message_active=message_pending;if(work==1)memcpy(card,card_pending,60000);if(work==2||newframe){memcpy(frame,pending,N);newframe=false;}xSemaphoreGive(mutex);
  if(work==3){busy=true;if(!home())fault=true;busy=false;}
  if(work==1){busy=true;release();bool ok=create_official();memset(white,255,15000);if(ok)ok=zectrix_epd_power_on(official)==ESP_OK&&zectrix_epd_refresh_full_1bpp(official,white,15000)==ESP_OK&&!stop;if(ok){ok=zectrix_epd_power_off(official)==ESP_OK&&!stop;if(ok)ok=zectrix_epd_power_on(official)==ESP_OK&&!stop;if(ok)ok=zectrix_epd_refresh_full_4bpp(official,card,60000)==ESP_OK;}release();busy=false;if(!ok){fault=true;stop=true;}}
  if(work==2){busy=true;auto rebase_t=now();release();bool ok=baseline(true)&&custom_init();memset(mask,255,N);for(int i=0;i<12&&ok;++i)ok=scan();constexpr unsigned doses[]={11,8,4,0};for(unsigned step=0;step<11&&ok;++step){for(size_t b=0;b<N;++b){unsigned m=0;for(unsigned k=0;k<4;++k){unsigned shift=6-2*k;if(step<doses[(frame[b]>>shift)&3])m|=2u<<shift;}mask[b]=m;}ok=scan();}printf("NOTE4 REBASE {\"ok\":%s,\"ms\":%d}\n",ok?"true":"false",(int)((now()-rebase_t)/1000));if(ok){plan.seed(frame);memset(mask,0,N);valid=true;}else {fault=true;stop=true;}busy=false;}
  if(valid&&!stop&&(changed||budget)){if(changed){plan.tuned=tuned;if(still)plan.settle();}unsigned active=plan.prepare(frame,mask);budget=active!=0;if(active){busy=true;if(scan())plan.delivered(mask);else {fault=true;stop=true;}busy=false;}}
  if(budget||changed)last_drive=now();
  // Keep controller RAM and pulse history, but remove panel high voltage when idle.
  if(analog&&!budget&&!changed&&now()-last_drive>300000){if(byte(2,0)&&wait_busy(10))analog=false;else{fault=true;stop=true;}}
  if(budget)vTaskDelay(pdMS_TO_TICKS(10));else ulTaskNotifyTake(pdTRUE,pdMS_TO_TICKS(300));
 }
}
}
bool display_init(){mutex=xSemaphoreCreateMutex();if(!mutex)return false;auto alloc=[](size_t n){return (uint8_t*)heap_caps_malloc(n,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);};pending=alloc(N);frame=alloc(N);mask=alloc(N);previous=alloc(N);card=alloc(60000);card_pending=alloc(60000);white=alloc(15000);pixels=(motion::HistoryPixel*)alloc(240000);history=(motion::Excursion*)alloc(360000);if(!pending||!frame||!mask||!previous||!card||!card_pending||!white||!pixels||!history)return false;gpio_config_t g{};g.pin_bit_mask=(1ULL<<6)|(1ULL<<9)|(1ULL<<10)|(1ULL<<11);g.mode=GPIO_MODE_OUTPUT;gpio_config(&g);g.pin_bit_mask=1ULL<<8;g.mode=GPIO_MODE_INPUT;gpio_config(&g);panel_emergency_cut();return xTaskCreate(task,"display_owner",6144,nullptr,4,&display_task)==pdPASS;}
bool display_card(const uint8_t* p,size_t n){if(n!=60000||panel_locked()||busy||(stop&&!quiesced))return false;xSemaphoreTake(mutex,portMAX_DELAY);memcpy(card_pending,p,n);fault=false;stop=false;request=1;xSemaphoreGive(mutex);if(display_task)xTaskNotifyGive(display_task);return true;}
bool display_frame(const uint8_t*p,size_t n){if(n!=N||panel_locked()||(stop&&!quiesced))return false;xSemaphoreTake(mutex,portMAX_DELAY);if(newframe)++frames_dropped;++submitted;memcpy(pending,p,n);if(!valid&&!busy){fault=false;stop=false;request=2;}newframe=true;xSemaphoreGive(mutex);if(display_task)xTaskNotifyGive(display_task);return true;}
void display_tune(bool settle,bool compensate){still=settle;tuned=compensate;}void display_rebase(){valid=false;}
void display_stop(){quiesced=false;stop=true;panel_emergency_cut();if(display_task)xTaskNotifyGive(display_task);}
void display_message(const std::string& text,uint32_t expected){if(expected==UINT32_MAX)expected=cancellation_generation();if(expected!=cancellation_generation())return;display_stop();auto epoch=panel_epoch();for(int i=0;i<600&&!quiesced;++i)vTaskDelay(pdMS_TO_TICKS(10));if(!quiesced||expected!=cancellation_generation())return;xSemaphoreTake(mutex,portMAX_DELAY);message_pending=text.substr(0,600);if(!panel_authorize(epoch)){xSemaphoreGive(mutex);return;}fault=false;stop=false;request=3;xSemaphoreGive(mutex);if(display_task)xTaskNotifyGive(display_task);}
void display_home(){display_message("NOTE4 1.1\nREADY\nHold UP 2s: Wi-Fi setup\nHold DOWN: STOP (stay online)");}
bool display_busy(){return busy;}
void display_clear_fault(){auto epoch=panel_epoch();for(int i=0;i<600&&stop&&!quiesced;++i)vTaskDelay(pdMS_TO_TICKS(10));if(stop&&!quiesced)return;if(!panel_authorize(epoch))return;fault=false;}
uint32_t display_dropped(){return frames_dropped;}
bool display_drive_active(){return analog;}
uint32_t display_scans(){return scans;}uint32_t display_scan_us(){return scan_us;}uint32_t display_submitted(){return submitted;}
bool display_ready(){return valid&&!stop;}bool display_fault(){return fault;}
}
