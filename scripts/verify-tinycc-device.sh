#!/data/data/com.termux/files/usr/bin/bash
# Device regression for patch 0002 (TinyCC reactivated on Android).
# Exercises bun:ffi cc(): TinyCC compiles C at runtime and the symbol is
# called through the FFI bridge. With tinycc disabled upstream, cc() falls
# back to dlopen-only and this fails; if bionic support were broken it
# would crash in libtcc or on the exec of the generated code.
# Usage: verify-tinycc-device.sh [path-to-bun]  (default ~/.bun-android/bin/bun)
set -euo pipefail

BUN=${1:-"$HOME/.bun-android/bin/bun"}
WORK="$TMPDIR/verify-tcc-$$"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/hello.c" <<'EOF'
int add3(int a, int b, int c) { return a + b + c; }
EOF

cat > "$WORK/cc.mjs" <<'EOF'
import { cc } from "bun:ffi";
const lib = cc({
  source: process.env.VERIFY_TCC_SRC,
  symbols: { add3: { returns: "i32", args: ["i32", "i32", "i32"] } },
});
const got = lib.symbols.add3(1, 2, 3);
console.log("cc add3(1,2,3) =", got);
if (got !== 6) process.exit(1);
EOF

VERIFY_TCC_SRC="$WORK/hello.c" "$BUN" run "$WORK/cc.mjs"
echo "OK: TinyCC cc() works on Android/Bionic"
