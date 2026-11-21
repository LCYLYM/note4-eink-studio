idf_component_register(SRCS "app_main.cpp" "display.cpp" "power_guard.cpp" "peripherals.cpp" "led_cue.cpp" "voice_agent.cpp" "store.cpp" "network.cpp" "net_api.cpp" "ota.cpp" "usb_work.cpp" "js_app.c" "js_bridge.cpp"
 EMBED_FILES "js_font16.bin.zz" "js_fonts_aa.bin.zz" EMBED_TXTFILES "js_probe_app.js"
 INCLUDE_DIRS "." REQUIRES mquickjs zectrix_epd gesture_audio gesture_detector zectrix_nfc esp_driver_gpio esp_driver_ledc esp_adc esp_driver_spi esp_driver_tsens esp_driver_usb_serial_jtag esp_timer esp_wifi esp_netif esp_event nvs_flash spiffs esp_http_client esp_http_server esp_https_ota app_update mbedtls json esp_psram)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
target_compile_options(${COMPONENT_LIB} PRIVATE -O2)

spiffs_create_partition_image(works ../data)

target_link_libraries(${COMPONENT_LIB} INTERFACE "-Wl,--wrap=gpio_set_level" "-Wl,--wrap=gpio_hold_en" "-Wl,--wrap=gpio_hold_dis")
