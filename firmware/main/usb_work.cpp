#include "esp_spiffs.h"
#include "usb_work.hpp"
#include "runtime_control.hpp"
#include "mbedtls/base64.h"
#include "mbedtls/sha256.h"
#include "esp_timer.h"
#include <cstdio>
#include <cstring>
#include <unistd.h>
namespace note4 {namespace {
FILE* file=nullptr;size_t wanted=0,written=0;uint32_t generation=0;
std::string expected;mbedtls_sha256_context hash;
}
void usb_work_abort(){if(file){fclose(file);file=nullptr;mbedtls_sha256_free(&hash);}remove("/data/staging.part");wanted=written=0;}
size_t usb_work_offset(){return written;}
bool usb_work_begin(size_t size,const char* sha,std::string& error){
    usb_work_abort();if(size<14||size>4194304||strlen(sha)!=64){error="size_or_digest";return false;}
    for(const char*p=sha;*p;++p)if(!(*p>='0'&&*p<='9')&&!(*p>='a'&&*p<='f')){error="digest_format";return false;}
    size_t total=0,used=0;if(esp_spiffs_info("works",&total,&used)!=ESP_OK||total-used<size+32768){error="storage_space";return false;}
    file=fopen("/data/staging.part","wb");if(!file){error="storage";return false;}
    wanted=size;expected=sha;generation=cancellation_generation();mbedtls_sha256_init(&hash);mbedtls_sha256_starts(&hash,0);return true;
}
bool usb_work_chunk(size_t offset,const char* encoded,std::string& error){
    if(!file||generation!=cancellation_generation()){error="stopped_or_no_upload";usb_work_abort();return false;}
    unsigned char data[512];size_t n=0;
    if(offset!=written||mbedtls_base64_decode(data,sizeof(data),&n,(const unsigned char*)encoded,strlen(encoded))!=0||!n||written+n>wanted){error="chunk_offset_or_size";return false;}
    if(fwrite(data,1,n,file)!=n||mbedtls_sha256_update(&hash,data,n)!=0){error="write";usb_work_abort();return false;}
    written+=n;return true;
}
bool usb_work_finish(Work& work,std::string& error){
    if(!file||written!=wanted||generation!=cancellation_generation()){error="incomplete_or_stopped";usb_work_abort();return false;}
    unsigned char digest[32];mbedtls_sha256_finish(&hash,digest);mbedtls_sha256_free(&hash);
    bool ok=fflush(file)==0&&fsync(fileno(file))==0;ok=fclose(file)==0&&ok;file=nullptr;
    char hex[65];for(int i=0;i<32;++i)snprintf(hex+2*i,3,"%02x",digest[i]);
    if(!ok||expected!=hex){error="digest_or_flush";remove("/data/staging.part");return false;}
    return validate_work("/data/staging.part",work,error);
}
}
