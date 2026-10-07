#!/usr/bin/env bash
# Installs the pinned toolchain declared in ci/source-manifest.json on the
# GitHub Actions ubuntu runner. Idempotent: each component skips when its
# stamp exists under $TOOL_HOME/.done/ (the directory itself is cached).
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
MANIFEST="$ROOT/ci/source-manifest.json"
TOOL_HOME="${TOOL_HOME:-$HOME/toolchain}"
SUDO="${SUDO:-sudo}"

mkdir -p "$TOOL_HOME/.done" "$TOOL_HOME/bin"

# python3 is preinstalled on ubuntu-latest; dotted-path getter over the manifest.
m() {
    python3 - "$MANIFEST" "$1" <<'PY'
import json, sys
cur = json.load(open(sys.argv[1]))
for k in sys.argv[2].split('.'):
    cur = cur[k]
print(cur)
PY
}

NDK_VER=$(m "tools.ndk")
LLVM_VER=$(m "tools.llvm")
CMAKE_VER=$(m "tools.cmake")
NODE_VER=$(m "tools.node")
BUN_HOST_VER=$(m "tools.bun_host")
RUST_VER=$(m "tools.rust")

done_() { [ -e "$TOOL_HOME/.done/$1" ]; }
mark_() { touch "$TOOL_HOME/.done/$1"; }

# Component check: a cached dir can hold stamps but not the files themselves
# (partial restore); re-run any component whose stamp exists but is missing.
cmake_ok()        { [ -x "$TOOL_HOME/cmake/bin/cmake" ]; }
node_ok()         { [ -x "$TOOL_HOME/node/bin/node" ]; }
bun_host_ok()     { [ -x "$TOOL_HOME/bun-host/bun-linux-x64/bun" ]; }
llvm_ok()         { [ -x "$TOOL_HOME/llvm/bin/clang" ]; }
ndk_ok()          { [ -d "$ANDROID_NDK_ROOT_DIR/toolchains/llvm/prebuilt" ]; }
ANDROID_NDK_ROOT_DIR="${TOOL_HOME}/android-ndk"
rust_ok()         { [ -x "$HOME/.cargo/bin/rustup" ] && "$HOME/.cargo/bin/rustup" toolchain list 2>/dev/null | grep -q "$RUST_VER"; }
apt_ok()          { command -v bison >/dev/null 2>&1; }

fetch() { # url dest
    curl -fsSL --retry 3 --retry-all-errors -o "$2" "$1"
}

# ---------- apt packages (runner-local; fast, not cached) ----------
need_pkgs=()
command -v ninja >/dev/null 2>&1 || need_pkgs+=(ninja-build)
command -v ccache >/dev/null 2>&1 || need_pkgs+=(ccache)
command -v bison >/dev/null 2>&1 || need_pkgs+=(bison)
command -v gawk >/dev/null 2>&1 || need_pkgs+=(gawk)
command -v ruby  >/dev/null 2>&1 || need_pkgs+=(ruby ruby-dev)
command -v go    >/dev/null 2>&1 || need_pkgs+=(golang)
dpkg -s libxml2-dev >/dev/null 2>&1 || need_pkgs+=(libxml2-dev)
gcc -dumpversion 2>/dev/null | grep -q '^13' || need_pkgs+=(gcc-13 g++-13)
if [ ${#need_pkgs[@]} -gt 0 ]; then
    $SUDO apt-get update -y
    DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y --no-install-recommends "${need_pkgs[@]}"
fi

# ---------- cmake ----------
# Binary tar.gz distribution, NOT the Kitware self-extractor .sh: the
# self-extractor dies with "can't cd to <prefix>" when extracting under
# $TOOL_HOME on the runner (M0 run 37624652911).
if ! { done_ cmake && cmake_ok; }; then
    fetch "$(m "tools.cmake_url")" /tmp/cmake.tar.gz
    mkdir -p "$TOOL_HOME/cmake"
    tar -xzf /tmp/cmake.tar.gz -C "$TOOL_HOME/cmake" --strip-components=1
    mark_ cmake
fi

# ---------- node ----------
if ! { done_ node && node_ok; }; then
    fetch "$(m "tools.node_url")" /tmp/node.tar.xz
    mkdir -p "$TOOL_HOME/node"
    tar -xJf /tmp/node.tar.xz -C "$TOOL_HOME/node" --strip-components=1
    mark_ node
fi

# ---------- bun host (codegen) ----------
if ! { done_ bun-host && bun_host_ok; }; then
    fetch "$(m "tools.bun_host_url")" /tmp/bun.zip
    mkdir -p "$TOOL_HOME/bun-host"
    unzip -q -o /tmp/bun.zip -d "$TOOL_HOME/bun-host"
    mark_ bun-host
fi

# ---------- LLVM/clang ----------
if ! { done_ llvm && llvm_ok; }; then
    url=""
    for flavour in ubuntu-24.04 ubuntu-22.04; do
        cand="https://github.com/llvm/llvm-project/releases/download/llvmorg-${LLVM_VER}/clang%2Bllvm-${LLVM_VER}-x86_64-linux-gnu-${flavour}.tar.xz"
        if curl -fsIL --retry 3 -o /dev/null "$cand"; then url="$cand"; break; fi
    done
    [ -n "$url" ] || { echo "no clang+llvm ${LLVM_VER} linux x64 asset found" >&2; exit 1; }
    fetch "$url" /tmp/llvm.tar.xz
    mkdir -p "$TOOL_HOME/llvm"
    tar -xJf /tmp/llvm.tar.xz -C "$TOOL_HOME/llvm" --strip-components=1
    mark_ llvm
fi

# ---------- NDK ----------
if ! { done_ ndk && ndk_ok; }; then
    fetch "$(m "tools.ndk_url")" /tmp/ndk.zip
    unzip -q /tmp/ndk.zip -d "$TOOL_HOME"
    mv "$TOOL_HOME/android-ndk-$NDK_VER" "$TOOL_HOME/android-ndk"
    # Trim what we don't use (mirrors upstream Dockerfile, saves ~1.1 GB).
    NDKP="$TOOL_HOME/android-ndk/toolchains/llvm/prebuilt/linux-x86_64"
    rm -rf "$NDKP/bin" "$NDKP/python3" "$NDKP/lib/liblldb.so" \
           "$NDKP"/lib/*-gnu "$NDKP"/lib/*-musl* \
           "$TOOL_HOME/android-ndk/simpleperf" "$TOOL_HOME/android-ndk/shader-tools" \
           "$TOOL_HOME/android-ndk/sources"
    mark_ ndk
fi

# ---------- rust ----------
if ! { done_ rust && rust_ok; }; then
    if ! command -v rustup >/dev/null 2>&1; then
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
            | sh -s -- -y --profile minimal --default-toolchain "$RUST_VER" -c rust-src
    else
        rustup toolchain install "$RUST_VER" --profile minimal -c rust-src
        rustup default "$RUST_VER"
    fi
    rustup target add aarch64-linux-android --toolchain "$RUST_VER"
    mark_ rust
fi

# ---------- PATH + env wiring ----------
ln -sf "$TOOL_HOME/cmake/bin/cmake"            "$TOOL_HOME/bin/cmake"
ln -sf "$TOOL_HOME/node/bin/node"              "$TOOL_HOME/bin/node"
ln -sf "$TOOL_HOME/bun-host/bun-linux-x64/bun" "$TOOL_HOME/bin/bun"
for t in clang clang++ lld ld.lld llvm-ar llvm-ranlib llvm-strip llvm-objcopy; do
    ln -sf "$TOOL_HOME/llvm/bin/$t" "$TOOL_HOME/bin/$t"
done
ln -sf "$TOOL_HOME/bin/clang"  "$TOOL_HOME/bin/cc"
ln -sf "$TOOL_HOME/bin/clang++" "$TOOL_HOME/bin/c++"

if [ -n "${GITHUB_PATH:-}" ]; then
    echo "$TOOL_HOME/bin" >> "$GITHUB_PATH"
    echo "$HOME/.cargo/bin" >> "$GITHUB_PATH"
fi
if [ -n "${GITHUB_ENV:-}" ]; then
    {
        echo "TOOL_HOME=$TOOL_HOME"
        echo "ANDROID_NDK_ROOT=$TOOL_HOME/android-ndk"
        echo "CC=clang"
        echo "CXX=clang++"
        echo "AR=llvm-ar"
        echo "RANLIB=llvm-ranlib"
    } >> "$GITHUB_ENV"
fi

echo "=== toolchain versions ==="
"$TOOL_HOME/bin/node" --version
"$TOOL_HOME/bin/bun" --version
"$TOOL_HOME/bin/cmake" --version | head -1
"$TOOL_HOME/bin/clang" --version | head -1
"$HOME/.cargo/bin/rustc" --version || true
echo "setup-runner: OK"
