#pragma once
#include <cstddef>
#include <string>
#include "store.hpp"
namespace note4 {
bool usb_work_begin(size_t,const char*,std::string&);
bool usb_work_chunk(size_t,const char*,std::string&);
bool usb_work_finish(Work&,std::string&);
void usb_work_abort();
size_t usb_work_offset();
}
