#!/data/data/com.termux/files/usr/bin/bash
# Device regression for the android tmpdir patch (patches/android/0004-*.patch).
# With TMPDIR absent, node:os tmpdir() must fall back to the Termux prefix
# tmp, not /data/local/tmp (not writable by the Termux app uid).
# Usage: verify-tmpdir-device.sh [path-to-bun]  (default ~/.bun-android/bin/bun)
set -euo pipefail

BUN=${1:-"$HOME/.bun-android/bin/bun"}
WORK="$TMPDIR/verify-tmpdir-$$"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/tmpdir.mjs" <<'EOF'
import os from "node:os";
import fs from "node:fs";
const dir = os.tmpdir();
console.log("tmpdir:", dir);
if (dir !== "/data/data/com.termux/files/usr/tmp") process.exit(1);
const made = fs.mkdtempSync(dir + "/bunverify-");
try {
  console.log("mkdtemp:", made);
} finally {
  fs.rmdirSync(made);
}
EOF

# env -u TMPDIR keeps the probe honest: the fallback must be the patch,
# not the inherited environment.
env -u TMPDIR -u TMP -u TEMP env -u TMPDIR -u TMP -u TEMP "$BUN" "$WORK/tmpdir.mjs"
echo "verify-tmpdir: OK"
