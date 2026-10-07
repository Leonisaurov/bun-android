#!/data/data/com.termux/files/usr/bin/bash
# On-device check for the bun-android side project. Runs in Termux.
# Installs the CI-produced ELF under ~/.bun-android/bin ONLY — never
# ~/.local/bin, which belongs to the closed opencode-termux port.
# Usage: verify-device.sh <path-to-bun-elf> [expected-version]
set -euo pipefail

SRC=${1:?usage: verify-device.sh <path-to-bun-elf> [expected-version]}
EXPECTED=${2:-1.4.2}

BIN_DIR="$HOME/.bun-android/bin"
mkdir -p "$BIN_DIR"
install -m 755 "$SRC" "$BIN_DIR/bun"

echo "=== installed ==="
ls -l "$BIN_DIR/bun"
sha256sum "$BIN_DIR/bun"

echo "=== --version (rc must be 0, output $EXPECTED) ==="
rc=0
out=$("$BIN_DIR/bun" --version 2>&1) || rc=$?
echo "bun --version -> '$out' rc=$rc"
[ "$rc" -eq 0 ] || { echo "bun failed to run on-device" >&2; exit 1; }
[ "$out" = "$EXPECTED" ] || { echo "version mismatch" >&2; exit 1; }

echo "=== OK: bun $EXPECTED runs natively in Termux ==="
echo "next: run the M2 smokes with this binary (fetch, bun:sqlite, bun install)."
