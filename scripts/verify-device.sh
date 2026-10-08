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

# Validar ANTES de tocar la instalación: este script escribía primero y
# chequeaba después, y un ELF viejo o mal apuntado (source==dest incluye el
# caso) downgradeaba el binario verificado. Medido en vivo 2026-10-08.
if [ "$SRC" -ef "$BIN_DIR/bun" ]; then
  echo "SRC y el instalado son el mismo archivo; nada que instalar." >&2
  exit 1
fi
src_version=$("$SRC" --version 2>&1) || { echo "ELF de CI no ejecutable: $src_version" >&2; exit 1; }
if [ "$src_version" != "$EXPECTED" ]; then
  echo "$SRC reporta '$src_version', esperado '$EXPECTED': NO instalo." >&2
  exit 1
fi

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
