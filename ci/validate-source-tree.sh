#!/usr/bin/env bash
# Validate the CI-fetched upstream tree against the pins and apply versioned
# patches with `git am`. Never leaves a dirty checkout: everything becomes a
# commit. Usage: validate-source-tree.sh <source-dir>
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
MANIFEST="$ROOT/ci/source-manifest.json"
SOURCE_DIR=${1:?usage: validate-source-tree.sh <source-dir>}

m() {
    python3 - "$MANIFEST" "$1" <<'PY'
import json, sys
cur = json.load(open(sys.argv[1]))
for k in sys.argv[2].split('.'):
    cur = cur[k]
print(cur)
PY
}

COMMIT=$(m "upstream.commit")
SHA256=$(m "upstream.tarball_sha256")
TAG=$(m "upstream.tag")

cd "$SOURCE_DIR"

# The codeload tarball ships no VERSION file; anchor the version on files that
# only exist at the pinned commit (scripts/build/ is the Rust-era build system).
[ -f scripts/build/profiles.ts ] || { echo "source tree missing scripts/build/profiles.ts" >&2; exit 1; }
[ -f scripts/build.ts ] || { echo "source tree missing scripts/build.ts" >&2; exit 1; }
[ ! -f build.zig ] || { echo "unexpected build.zig (Zig-era tree?) at pinned commit" >&2; exit 1; }
tag_name=$(grep -o '"ci-build"' scripts/build/profiles.ts | head -1)
[ -n "$tag_name" ] || { echo "profiles.ts lacks ci-build profile" >&2; exit 1; }
echo "source anchors OK ($TAG; VERSION file absent by design in tarball)"

# The tarball has no git history; graft the pinned commit as the baseline so
# patches apply as trackable commits on top of an otherwise clean tree.
if [ ! -d .git ]; then
    git init -q -b main
    git -c user.email=ci@localhost -c user.name=ci add -A
    git -c user.email=ci@localhost -c user.name=ci \
        commit -q -m "upstream $TAG (${COMMIT:0:12}) tarball sha256 ${SHA256:0:12}"
fi

shopt -s nullglob
for p in "$ROOT"/patches/android/*.patch; do
    echo "applying $(basename "$p")"
    git -c user.email=ci@localhost -c user.name=ci am --3way "$p"
done

status=$(git status --porcelain)
[ -z "$status" ] || { echo "tree not clean after patches:"; echo "$status" >&2; exit 1; }

echo "validate-source-tree: OK ($(git rev-parse --short HEAD), $(ls "$ROOT"/patches/android/*.patch 2>/dev/null | wc -l) patches)"
