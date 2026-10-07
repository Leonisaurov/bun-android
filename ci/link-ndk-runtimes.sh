#!/usr/bin/env bash
# Symlink the NDK's compiler-rt builtins and libunwind into the host clang's
# resource dir. clang's android driver looks for
# <resource-dir>/lib/<triple>/libclang_rt.* with no -L fallback; the NDK
# ships those runtime bits but the host clang does not know where they are.
# Mirrors upstream .buildkite/Dockerfile (Android NDK section).
set -euo pipefail

: "${ANDROID_NDK_ROOT:?ANDROID_NDK_ROOT must point at the pinned NDK}"

NDK_CLANG_DIR="$ANDROID_NDK_ROOT/toolchains/llvm/prebuilt/linux-x86_64/lib/clang"
NDK_VER_DIR=$(ls "$NDK_CLANG_DIR")
NDK_RT="$NDK_CLANG_DIR/$NDK_VER_DIR/lib/linux"

RES=$(clang -print-resource-dir)
mkdir -p "$RES/lib/linux"

for A in aarch64 x86_64; do
    ln -sf "$NDK_RT/libclang_rt.builtins-${A}-android.a" "$RES/lib/linux/"
    mkdir -p "$RES/lib/linux/$A"
    ln -sf "$NDK_RT/$A/libunwind.a" "$RES/lib/linux/$A/"
    DIR="$RES/lib/${A}-unknown-linux-android28"
    mkdir -p "$DIR"
    ln -sf "$NDK_RT/libclang_rt.builtins-${A}-android.a" "$DIR/libclang_rt.builtins.a"
    ln -sf "$NDK_RT/$A/libunwind.a" "$DIR/libunwind.a"
done

echo "link-ndk-runtimes: OK (resource dir $RES, NDK clang $NDK_VER_DIR)"
