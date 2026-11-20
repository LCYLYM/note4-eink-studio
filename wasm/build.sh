#!/bin/sh
# Builds wasm/note4_vm.wasm from the same engine sources the firmware uses.
set -eu
cd "$(dirname "$0")/.."
. ./.toolchains/emsdk/emsdk_env.sh >/dev/null 2>&1
E=firmware/components/mquickjs
emcc -O2 -w -sSUPPORT_LONGJMP=wasm -sSTANDALONE_WASM --no-entry -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=8MB -sSTACK_SIZE=256KB -sERROR_ON_UNDEFINED_SYMBOLS=1 \
  -I"$E" -Ifirmware/main wasm/note4_vm.c "$E/mquickjs.c" "$E/cutils.c" "$E/dtoa.c" "$E/libm.c" -o wasm/note4_vm.wasm
ls -l wasm/note4_vm.wasm
