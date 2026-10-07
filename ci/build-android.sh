#!/usr/bin/env bash
# Cross-build Bun for aarch64-linux-android from the validated source tree.
# Mirrors the official .buildkite command for this tag:
#   node --experimental-strip-types scripts/build.ts \
#     --profile=ci-build --os=linux --arch=aarch64 --abi=android
# API level is upstream's ANDROID_API_LEVEL_DEFAULT (28): it is not a CLI
# field in scripts/build.ts and the official JSC prebuilt is compiled
# against android28, so we do not override it.
set -euo pipefail

: "${SOURCE_DIR:?SOURCE_DIR must point at the validated upstream tree}"
: "${ANDROID_NDK_ROOT:?ANDROID_NDK_ROOT must point at the pinned NDK}"

CACHE_DIR="${BUN_BUILD_CACHE_DIR:-$HOME/.cache/bun-build}"
mkdir -p "$CACHE_DIR"

cd "$SOURCE_DIR"

# The build graph produces the runnable bun under build/<dir>/; find it
# whatever the profile names the artifact (bun vs bun-profile).
find_built_bun() {
    find build -maxdepth 3 -type f \( -name 'bun' -o -name 'bun-profile' \) -perm -u+x | head -n1
}

# Upstream's builder requires Node >= 25 for codegen; the documented entry
# point on CI is `bun scripts/build.ts` with the pinned host bun.
# --buildkite=false: ci-build implies buildkite:true, whose ninja graph
# embeds `buildkite-agent artifact upload` edges absent on GitHub Actions.
bun scripts/build.ts \
    --profile=ci-build --os=linux --arch=aarch64 --abi=android \
    --buildkite=false \
    --android-ndk="$ANDROID_NDK_ROOT" --cache-dir="$CACHE_DIR" "$@"

BIN=$(find_built_bun)
[ -n "$BIN" ] || { echo "build finished but no android bun artifact found under build/" >&2; exit 1; }

echo "artifact: $BIN"
readelf -h "$BIN" | grep -E 'Class|Machine|OS/ABI'
readelf -d "$BIN" | grep -E 'libc\.so' || {
    echo "ELF is not dynamically linked against libc.so (bionic)" >&2; exit 1; }
sha256sum "$BIN"
mv "$BIN" "${RUNNER_TEMP:-.}/bun-aarch64-android"
