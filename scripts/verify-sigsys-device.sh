#!/data/data/com.termux/files/usr/bin/bash
# Device regression for the android openat2 patch (patches/android/0001-*.patch).
# Before the patch, a `Bun.serve` directory route died with SIGSYS (rc=159)
# because openat2 is not in the Android app seccomp allowlist.
# Usage: verify-sigsys-device.sh [path-to-bun]  (default ~/.bun-android/bin/bun)
set -euo pipefail

BUN=${1:-"$HOME/.bun-android/bin/bun"}
WORK="$TMPDIR/verify-sigsys-$$"
mkdir -p "$WORK/static"
trap 'rm -rf "$WORK"' EXIT
echo "hola-sigsys" > "$WORK/static/thing.txt"

cat > "$WORK/serve.mjs" <<'EOF'
const server = Bun.serve({
  unix: process.env.VERIFY_SOCK,
  routes: { "/static/*": { dir: "./static" } },
});
const r = await fetch("http://bun.unix/static/thing.txt", { unix: process.env.VERIFY_SOCK });
const body = (await r.text()).trim();
console.log("status:", r.status, "body:", body);
server.stop();
if (r.status !== 200 || body !== "hola-sigsys") process.exit(1);
EOF

cat > "$WORK/spawn.mjs" <<'EOF'
const p = Bun.spawnSync(["echo", "spawn-ok"]);
console.log("spawn exit:", p.exitCode, "out:", p.stdout.toString().trim());
if (p.exitCode !== 0) process.exit(1);
EOF

cat > "$WORK/chmod.mjs" <<'EOF'
import { chmodSync, statSync, writeFileSync } from "fs";
const f = process.env.VERIFY_WORK + "/chmod-probe.txt";
writeFileSync(f, "x");
chmodSync(f, 0o600);
const mode = (statSync(f).mode & 0o777).toString(8);
console.log("chmod ok, mode:", mode);
if (mode !== "600") process.exit(1);
EOF

cd "$WORK"
echo "=== serve (openat2 fallback) ==="
VERIFY_SOCK="$WORK/serve.sock" VERIFY_WORK="$WORK" "$BUN" run serve.mjs
echo "=== spawn (close_range) ==="
"$BUN" run spawn.mjs
echo "=== chmod (fchmodat2) ==="
VERIFY_WORK="$WORK" "$BUN" run chmod.mjs
echo "OK: no SIGSYS on serve/spawn/chmod paths"
