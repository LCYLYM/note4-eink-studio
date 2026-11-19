idf_component_register(SRCS "i2c_bus_lock.cc" "i2c_device.cc" "zectrix_nfc.cc" INCLUDE_DIRS "." REQUIRES esp_driver_gpio esp_driver_i2c esp_timer)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
