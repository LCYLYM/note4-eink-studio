idf_component_register(
    SRCS "gesture_audio.cpp"
    INCLUDE_DIRS "include"
    REQUIRES zectrix_nfc esp_codec_dev esp_driver_gpio esp_driver_i2c esp_driver_i2s)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
