#!/data/data/com.termux/files/usr/bin/bash
# On-device surface battery for the bun-android port.
#
# Runs every case listed in tests/fixtures/cases.txt as an ISOLATED process
# (one `bun <fixture> <case>` per case, with a timeout), so a crash, a SIGSYS
# death or an infinite loop in one case cannot hide the rest of the battery.
#
# Evidence rules (docs/VERIFY.md): the rc of the battery is the rc of each
# `bun` process, never the rc of a pipe. Nothing here compiles anything: the
# binary under test always comes from CI.
#
# Usage:
#   battery-device.sh [--bun PATH] [--tiers T1,T4] [--case ID] [--json OUT]
#                     [--keep] [--list] [--min-free-mb N]
#
# A case whose first stdout line is "#SKIP <reason>" counts as SKIP, not PASS.
# expect=KNOWN cases are EXPECTED to fail (documented limitation); if one of
# them suddenly passes the battery says so, because that is news too.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FIX="$ROOT/tests/fixtures"
MANIFEST="$FIX/cases.txt"

BUN="$HOME/.bun-android/bin/bun"
TIERS=""
ONLY=""
JSON_OUT=""
KEEP=0
LIST=0
MIN_FREE_MB=3000
PREFIX_DIR="${PREFIX:-/data/data/com.termux/files/usr}"

while [ $# -gt 0 ]; do
  case "$1" in
    --bun) BUN=${2:?--bun needs a path}; shift 2 ;;
    --tiers) TIERS=${2:?--tiers needs a comma list}; shift 2 ;;
    --case) ONLY=${2:?--case needs an id}; shift 2 ;;
    --json) JSON_OUT=${2:?--json needs a path}; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --list) LIST=1; shift ;;
    --min-free-mb) MIN_FREE_MB=${2:?}; shift 2 ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

[ -x "$BUN" ] || { echo "no hay binario ejecutable en $BUN" >&2; exit 2; }
[ -f "$MANIFEST" ] || { echo "falta el manifiesto $MANIFEST" >&2; exit 2; }

if [ "$LIST" = 1 ]; then
  grep -vE '^\s*(#|$)' "$MANIFEST" | while IFS='|' read -r tier file case tmo expect; do
    printf '%-3s %-22s %-6s %s\n' "$tier" "$case" "$tmo" "$expect"
  done
  exit 0
fi

# --- disk gate: 289 MB binaries and node_modules live here; refuse to start
# a loop that could half-write an install.
avail_kb=$(df -k "$PREFIX_DIR" | awk 'NR==2 {print $4}')
avail_mb=$((avail_kb / 1024))
if [ "$avail_mb" -lt "$MIN_FREE_MB" ]; then
  echo "disco insuficiente: ${avail_mb} MB libres en $PREFIX_DIR (min $MIN_FREE_MB MB)." >&2
  echo "limpiá scratch (--compile genera ~291 MB) y reintentá." >&2
  exit 3
fi

SHA=$(sha256sum "$BUN" | cut -d' ' -f1)
REVISION=$(timeout 30 "$BUN" --revision 2>&1 | head -n1)
VERSION=$(timeout 30 "$BUN" --version 2>&1 | head -n1)

STAGE="${TMPDIR:-$PREFIX_DIR/tmp}/battery-${SHA:0:8}-$$"
mkdir -p "$STAGE"
cleanup() { [ "$KEEP" = 1 ] || rm -rf "$STAGE"; }
trap cleanup EXIT

echo "=== bun-android battery ==="
echo "bun:      $BUN"
echo "version:  $VERSION"
echo "revision: $REVISION"
echo "sha256:   $SHA"
echo "stage:    $STAGE"
echo "disk:     ${avail_mb} MB libres"
echo

pass=0 fail=0 skip=0 known=0 unexpected=0 timeout_n=0
declare -a failed_list=()

while IFS='|' read -r tier file case tmo expect; do
  case "$tier" in ''|'#'*) continue ;; esac
  if [ -n "$TIERS" ] && ! printf '%s' ",$TIERS," | grep -q ",$tier,"; then continue; fi
  if [ -n "$ONLY" ] && [ "$ONLY" != "$case" ]; then continue; fi

  cdir="$STAGE/$tier/$case"
  mkdir -p "$cdir"
  t0=$(date +%s%3N 2>/dev/null || echo 0)
  # rc comes from the bun process directly (via the subshell), never from a
  # pipe: `cmd | tail` would report tail's status and turn reds green.
  ( cd "$cdir" && BATTERY_CASE_DIR="$cdir" BATTERY_BUN="$BUN" BATTERY_TIER="$tier" \
      timeout -k 5 "$tmo" "$BUN" "$FIX/$file" "$case" ) >"$cdir/.out" 2>"$cdir/.err"
  rc=$?
  dur=$(( $(date +%s%3N 2>/dev/null || echo 0) - t0 ))

  verdict=""
  if head -n1 "$cdir/.out" 2>/dev/null | grep -q '^#SKIP'; then
    verdict=SKIP
    skip=$((skip + 1))
  elif [ "$rc" = 124 ] || [ "$rc" = 137 ]; then
    verdict=TIMEOUT; timeout_n=$((timeout_n + 1)); fail=$((fail + 1))
  elif [ "$rc" = 0 ]; then
    if [ "$expect" = KNOWN ]; then
      verdict="KNOWN-PASS"; unexpected=$((unexpected + 1))
    else
      verdict=PASS; pass=$((pass + 1))
    fi
  else
    if [ "$expect" = KNOWN ]; then
      verdict=KNOWN; known=$((known + 1))
    else
      verdict=FAIL; fail=$((fail + 1))
      failed_list+=("$tier/$case")
    fi
  fi

  printf '%-8s %-3s %-24s rc=%-3s %6sms\n' "$verdict" "$tier" "$case" "$rc" "$dur"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$tier" "$case" "$rc" "$dur" "$verdict" "$expect" "${SHA:0:12}" \
    >>"$STAGE/results.tsv"

  if [ "$verdict" = FAIL ] || [ "$verdict" = TIMEOUT ]; then
    sed -e 's/^/      | /' "$cdir/.err" 2>/dev/null | tail -n 15
    sed -e 's/^/      > /' "$cdir/.out" 2>/dev/null | tail -n 5
  fi
done < "$MANIFEST"

echo
echo "=== totals ==="
echo "PASS=$pass FAIL=$fail TIMEOUT=$timeout_n SKIP=$skip KNOWN=$known UNEXPECTED=$unexpected"
if [ ${#failed_list[@]} -gt 0 ]; then
  echo "rojos:"
  printf '  - %s\n' "${failed_list[@]}"
fi

if [ -n "$JSON_OUT" ]; then
  {
    printf '{"bun_sha":"%s","bun_revision":"%s","bun_version":"%s","date":"%s","totals":{"pass":%d,"fail":%d,"timeout":%d,"skip":%d,"known":%d,"unexpected":%d},"cases":[' \
      "$SHA" "$REVISION" "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      "$pass" "$fail" "$timeout_n" "$skip" "$known" "$unexpected"
    first=1
    while IFS=$'\t' read -r tier case rc dur verdict expect sha; do
      [ $first = 1 ] || printf ','
      first=0
      printf '{"tier":"%s","case":"%s","rc":%s,"ms":%s,"verdict":"%s","expect":"%s"}' \
        "$tier" "$case" "$rc" "$dur" "$verdict" "$expect"
    done < "$STAGE/results.tsv"
    printf ']}\n'
  } > "$JSON_OUT"
  echo "json:     $JSON_OUT"
fi

[ "$fail" = 0 ] && [ "$unexpected" = 0 ] || exit 1
exit 0
