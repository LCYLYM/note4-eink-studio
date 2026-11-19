idf_component_register(SRCS "mquickjs.c" "cutils.c" "dtoa.c" "libm.c" INCLUDE_DIRS ".")
target_compile_options(${COMPONENT_LIB} PRIVATE -O2 -w)
