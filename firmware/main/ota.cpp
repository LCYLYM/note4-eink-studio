#include "ota.hpp"
#include "runtime_control.hpp"
#include "startup.hpp"
#include "esp_https_ota.h"
#include "esp_ota_ops.h"
#include "esp_app_desc.h"
#include "esp_crt_bundle.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_partition.h"
#include "mbedtls/sha256.h"
#include "nvs.h"
#include "cJSON.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cstdio>
#include <cstring>
#include <array>
#include <atomic>
#include <algorithm>
namespace note4 {
int device_http(const std::string&,const std::string&,std::string&);
bool receipt_ack(const Command&,const char*,const char*);
namespace {
constexpr uint32_t SLOT_SIZE=0x300000;
struct Release {std::string id,version,url,sha;uint32_t bytes=0;};
struct Download {mbedtls_sha256_context hash;size_t received=0,limit=0;bool(*cancel)()=nullptr;bool failed=false;};
std::atomic<bool> pending_boot{false};bool failure_hold=false;int64_t boot_deadline=0,next_attempt=0;
Command pending_command;std::string expected_version;std::string status="valid";
std::string str(cJSON*j,const char*k){auto*v=cJSON_GetObjectItem(j,k);return cJSON_IsString(v)?v->valuestring:"";}
std::string nvsstr(nvs_handle_t h,const char*k){size_t n=0;if(nvs_get_str(h,k,nullptr,&n)!=ESP_OK||n>4096)return {};std::string s(n,'\0');if(nvs_get_str(h,k,s.data(),&n)!=ESP_OK)return {};s.resize(n-1);return s;}
void clear_pending(){nvs_handle_t h;if(nvs_open("ota",NVS_READWRITE,&h)==ESP_OK){nvs_erase_key(h,"pending");nvs_commit(h);nvs_close(h);}}
bool save_pending(const Command&c,const Release&r){auto*j=cJSON_CreateObject();cJSON_AddStringToObject(j,"command_id",c.command_id.c_str());cJSON_AddStringToObject(j,"build_id",c.build_id.c_str());cJSON_AddStringToObject(j,"run_id",c.run_id.c_str());cJSON_AddStringToObject(j,"release_id",r.id.c_str());cJSON_AddStringToObject(j,"version",r.version.c_str());char*p=cJSON_PrintUnformatted(j);nvs_handle_t h;bool ok=p&&nvs_open("ota",NVS_READWRITE,&h)==ESP_OK;if(ok){ok=nvs_set_str(h,"pending",p)==ESP_OK&&nvs_commit(h)==ESP_OK;nvs_close(h);}cJSON_free(p);cJSON_Delete(j);return ok;}
bool version(const std::string&s,std::array<unsigned,3>&v){if(s.empty()||s.size()>31)return false;unsigned a,b,c;char extra;if(sscanf(s.c_str(),"%u.%u.%u%c",&a,&b,&c,&extra)!=3||a>65535||b>65535||c>65535)return false;v={a,b,c};return true;}
bool layout_valid(){const auto*a=esp_partition_find_first(ESP_PARTITION_TYPE_APP,ESP_PARTITION_SUBTYPE_APP_OTA_0,"ota_0");const auto*b=esp_partition_find_first(ESP_PARTITION_TYPE_APP,ESP_PARTITION_SUBTYPE_APP_OTA_1,"ota_1");const auto*d=esp_partition_find_first(ESP_PARTITION_TYPE_DATA,ESP_PARTITION_SUBTYPE_DATA_OTA,"otadata");const auto*w=esp_partition_find_first(ESP_PARTITION_TYPE_DATA,ESP_PARTITION_SUBTYPE_DATA_SPIFFS,"works");const auto*n=esp_partition_find_first(ESP_PARTITION_TYPE_DATA,ESP_PARTITION_SUBTYPE_DATA_NVS,"nvs");const auto*phy=esp_partition_find_first(ESP_PARTITION_TYPE_DATA,ESP_PARTITION_SUBTYPE_DATA_PHY,"phy_init");return n&&phy&&n->address==0x9000&&n->size==0x5000&&phy->address==0xe000&&phy->size==0x1000&&a&&b&&d&&w&&a->address==0x20000&&a->size==SLOT_SIZE&&b->address==0x320000&&b->size==SLOT_SIZE&&d->address==0xf000&&d->size==0x2000&&w->address==0x620000&&w->size==0x9e0000;}
bool parse(const std::string&s,Release&r){auto*j=cJSON_Parse(s.c_str());if(!j)return false;auto*wrapped=cJSON_GetObjectItem(j,"release");auto*m=wrapped?wrapped:j;r.id=str(m,"release_id");r.version=str(m,"version");r.url=str(m,"url");r.sha=str(m,"sha256");auto*bytes=cJSON_GetObjectItem(m,"byte_length");auto*abi=cJSON_GetObjectItem(m,"abi");bool ok=str(m,"model")==OTA_MODEL&&str(m,"layout")==OTA_LAYOUT&&cJSON_IsNumber(abi)&&abi->valuedouble==OTA_ABI&&cJSON_IsNumber(bytes)&&bytes->valuedouble>=1024&&bytes->valuedouble<=SLOT_SIZE&&bytes->valuedouble==bytes->valueint&&!r.id.empty()&&r.id.size()<=96&&r.sha.size()==64&&r.url.rfind("https://",0)==0&&artifact_authorized(r.url.c_str());if(ok)r.bytes=bytes->valueint;for(char c:r.sha)ok=ok&&((c>='0'&&c<='9')||(c>='a'&&c<='f'));std::array<unsigned,3> current,target;ok=ok&&version(r.version,target)&&version(esp_app_get_description()->version,current)&&target>current;cJSON_Delete(j);return ok;}
bool ota_cancel_requested(const std::string&id){std::string escaped;constexpr char h[]="0123456789ABCDEF";for(unsigned char c:id){if((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='-'||c=='_')escaped+=char(c);else{escaped+='%';escaped+=h[c>>4];escaped+=h[c&15];}}std::string out;int code=device_http("/api/device/ota-status?command_id="+escaped,"",out);if(code!=200)return false;auto*j=cJSON_Parse(out.c_str());bool cancelled=cJSON_IsTrue(cJSON_GetObjectItem(j,"cancel_requested"));cJSON_Delete(j);return cancelled;}
esp_err_t on_http(esp_http_client_event_t*e){auto*d=static_cast<Download*>(e->user_data);if(!d)return ESP_FAIL;if(d->cancel&&d->cancel()){d->failed=true;return ESP_FAIL;}if(e->event_id==HTTP_EVENT_ON_DATA){if(e->data_len<0||d->received+size_t(e->data_len)>d->limit){d->failed=true;return ESP_FAIL;}if(mbedtls_sha256_update(&d->hash,(const unsigned char*)e->data,e->data_len)!=0){d->failed=true;return ESP_FAIL;}d->received+=e->data_len;}return ESP_OK;}
esp_err_t authorize(esp_http_client_handle_t h){std::string value="Bearer "+std::string(device_token());return esp_http_client_set_header(h,"Authorization",value.c_str());}
void rollback(const char*why){status="rollback_requested";receipt(pending_command,"failed",why);observed_changed();esp_err_t e=esp_ota_mark_app_invalid_rollback_and_reboot();if(e!=ESP_OK){status="rollback_unavailable";failure_hold=true;receipt(pending_command,"failed","rollback_unavailable_management_hold");observed_changed();printf("NOTE4 OTA_ROLLBACK_UNAVAILABLE %s\n",esp_err_to_name(e));}}
}
bool ota_execute(const Command&c,const std::string&json,bool(*cancelled)()){
 Release r;if(!layout_valid()||!parse(json,r)||pending_boot){receipt(c,"failed","ota_manifest_layout_version_or_pending");return false;}
 const auto*running=esp_ota_get_running_partition();const auto*target=esp_ota_get_next_update_partition(nullptr);if(!target||target==running||r.bytes>target->size){receipt(c,"failed","ota_no_inactive_slot");return false;}
 if(cancelled&&cancelled()){receipt(c,"cancelled","ota_cancel_before_begin");return false;}
 receipt(c,"downloading","system_ota_inactive_slot");Download d{};d.limit=r.bytes;d.cancel=cancelled;mbedtls_sha256_init(&d.hash);mbedtls_sha256_starts(&d.hash,0);
 esp_http_client_config_t http{};http.url=r.url.c_str();http.crt_bundle_attach=esp_crt_bundle_attach;http.timeout_ms=5000;http.disable_auto_redirect=true;http.buffer_size=4096;http.event_handler=on_http;http.user_data=&d;http.keep_alive_enable=true;
 esp_https_ota_config_t config{};config.http_config=&http;config.http_client_init_cb=authorize;config.bulk_flash_erase=false;
 esp_https_ota_handle_t handle=nullptr;esp_err_t err=esp_https_ota_begin(&config,&handle);bool remote_cancel=false;
 if(err==ESP_OK){esp_app_desc_t desc{};err=esp_https_ota_get_img_desc(handle,&desc);if(err==ESP_OK&&(strncmp(desc.version,r.version.c_str(),sizeof(desc.version))||strncmp(desc.project_name,"note4_joint",sizeof(desc.project_name))))err=ESP_ERR_INVALID_VERSION;}
 int64_t check_at=0;
 while(err==ESP_OK||err==ESP_ERR_HTTPS_OTA_IN_PROGRESS){
  if(d.failed||(cancelled&&cancelled())){err=ESP_FAIL;break;}
  if(esp_timer_get_time()>=check_at){check_at=esp_timer_get_time()+2000000;remote_cancel=ota_cancel_requested(c.command_id);if(remote_cancel){err=ESP_FAIL;break;}}
  err=esp_https_ota_perform(handle);if(err!=ESP_ERR_HTTPS_OTA_IN_PROGRESS)break;vTaskDelay(1);
 }
 unsigned char digest[32];mbedtls_sha256_finish(&d.hash,digest);mbedtls_sha256_free(&d.hash);char hex[65];for(int i=0;i<32;++i)snprintf(hex+2*i,3,"%02x",digest[i]);
 bool complete=handle&&esp_https_ota_is_complete_data_received(handle);bool cancelled_now=remote_cancel||(cancelled&&cancelled());
 if(err!=ESP_OK||d.failed||!complete||d.received!=r.bytes||size_t(esp_https_ota_get_image_len_read(handle))!=r.bytes||r.sha!=hex||cancelled_now){if(handle)esp_https_ota_abort(handle);receipt(c,cancelled_now?"cancelled":"failed",cancelled_now?"ota_cancelled_old_boot_unchanged":"ota_transfer_image_or_sha256");return false;}
 receipt(c,"verified","ota_size_image_sha256_valid");if(ota_cancel_requested(c.command_id)||(cancelled&&cancelled())){esp_https_ota_abort(handle);receipt(c,"cancelled","ota_cancel_before_commit");return false;}
 if(!save_pending(c,r)){esp_https_ota_abort(handle);receipt(c,"failed","ota_pending_nvs");return false;}
 // Serialize the irreversible commit phase at the gateway before selecting boot.
 // If this acknowledgement is unavailable, leave the old boot selected instead of rebooting silently.
 if(!receipt_ack(c,"rebooting","verified_commit_phase_new_image_not_yet_confirmed")){esp_https_ota_abort(handle);clear_pending();receipt(c,"failed","ota_commit_ack_unavailable_old_boot_unchanged");return false;}
 if(cancelled&&cancelled()){esp_https_ota_abort(handle);clear_pending();receipt(c,"cancelled","local_stop_before_finish");return false;}
 // IDF finish validates the image and atomically selects the inactive slot; never touches works/NVS.
 err=esp_https_ota_finish(handle);handle=nullptr;if(err!=ESP_OK){clear_pending();receipt(c,"failed","ota_finish_validation");return false;}
 if(cancelled&&cancelled()){esp_err_t restored=esp_ota_set_boot_partition(running);if(restored==ESP_OK){clear_pending();receipt(c,"cancelled","ota_cancel_boot_restored");return false;}receipt(c,"failed","ota_boot_restore_failed_no_restart");return false;}
 esp_restart();return true;
}
void ota_boot_begin(){const auto*p=esp_ota_get_running_partition();esp_ota_img_states_t state=ESP_OTA_IMG_UNDEFINED;esp_ota_get_state_partition(p,&state);nvs_handle_t h;std::string saved;if(nvs_open("ota",NVS_READONLY,&h)==ESP_OK){saved=nvsstr(h,"pending");nvs_close(h);}auto*j=cJSON_Parse(saved.c_str());if(j){pending_command.command_id=str(j,"command_id");pending_command.build_id=str(j,"build_id");pending_command.run_id=str(j,"run_id");pending_command.op="ota";expected_version=str(j,"version");cJSON_Delete(j);}
 if(state==ESP_OTA_IMG_PENDING_VERIFY||!pending_command.command_id.empty()){pending_boot=true;status=state==ESP_OTA_IMG_PENDING_VERIFY?"pending_verify":"report_pending";boot_deadline=esp_timer_get_time()+120000000;next_attempt=0;if(state==ESP_OTA_IMG_PENDING_VERIFY&&(expected_version.empty()||!layout_valid()))rollback("local_selfcheck_or_metadata_failed");}
}
void ota_boot_poll(bool hello_accepted){if(!pending_boot||failure_hold)return;esp_ota_img_states_t state=ESP_OTA_IMG_UNDEFINED;esp_ota_get_state_partition(esp_ota_get_running_partition(),&state);if(esp_timer_get_time()>boot_deadline&&state==ESP_OTA_IMG_PENDING_VERIFY){rollback("ready_ack_timeout");return;}if(state==ESP_OTA_IMG_PENDING_VERIFY&&runtime_startup_failed()){rollback("local_managers_failed");return;}if(!hello_accepted||esp_timer_get_time()<next_attempt)return;next_attempt=esp_timer_get_time()+10000000;
 if(expected_version!=esp_app_get_description()->version){if(receipt_ack(pending_command,"rolled_back","old_firmware_booted_after_unconfirmed_update")){clear_pending();pending_boot=false;status="valid";}return;}
 if(!runtime_local_ready()){if(state==ESP_OTA_IMG_PENDING_VERIFY&&runtime_startup_failed())rollback("local_managers_failed");return;}
 if(state==ESP_OTA_IMG_PENDING_VERIFY){if(!receipt_ack(pending_command,"ready","local_managers_ready_gateway_acknowledged"))return;if(esp_ota_mark_app_valid_cancel_rollback()!=ESP_OK){rollback("mark_valid_failed");return;}}
 status="valid";if(receipt_ack(pending_command,"confirmed","new_firmware_valid_preserved_data")){clear_pending();pending_boot=false;observed_changed();}
}
bool ota_boot_pending(){return pending_boot;}
std::string ota_firmware_json(){auto*j=cJSON_CreateObject();cJSON_AddStringToObject(j,"version",esp_app_get_description()->version);cJSON_AddStringToObject(j,"model",OTA_MODEL);cJSON_AddStringToObject(j,"layout",OTA_LAYOUT);cJSON_AddNumberToObject(j,"abi",OTA_ABI);cJSON_AddStringToObject(j,"ota_state",status.c_str());char*p=cJSON_PrintUnformatted(j);std::string s=p?p:"{}";cJSON_free(p);cJSON_Delete(j);return s;}
}
