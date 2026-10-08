# bun-android — side project

Port of **Bun v1.4.2** (Rust rewrite; zero `.zig` files) to Android/Bionic,
built from source in our own GitHub Actions. Milestones M0–M4 plus the broad
on-device audits — A1 surface, A2 surface extension + upstream parity
classification, A3 product-surface tier T10 classified the same way, A4
root-cause of the libtcc SIGSEGV with a verified workaround, A5 patch 0008
(Termux resolv.conf into c-ares) — live in [`docs/PROGRESS.md`](docs/PROGRESS.md);
all upstream pins live in [`ci/source-manifest.json`](ci/source-manifest.json).

**First public release**: [`v1.4.2-android.1`](https://github.com/Leonisaurov/bun-android/releases/tag/v1.4.2-android.1)
— the `a8-full` binary (157 battery cases, 148 PASS / 0 FAIL / 9 KNOWN), sha256
`3c61913c9420c578536225e4f11a85ecf9619a26f6c0094d06b06bff30de31f9`, four assets,
verified by downloading the release on the phone. Procedure and record:
[`docs/RELEASE.md`](docs/RELEASE.md).

This is a **side project**. It is deliberately isolated from the
`opencode-termux` workspace, whose Bun port (era-Zig: runtime 1.2.13 +
standalone-graph emitter 1.3.2) is closed and must not be touched from here.

**Donde empezar**: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (mapa del
repo) → [`docs/BUILD.md`](docs/BUILD.md) (receta/pins) →
[`docs/PROGRESS.md`](docs/PROGRESS.md) (estado y evidencia) →
[`docs/ROADMAP.md`](docs/ROADMAP.md) (lo pendiente).

## Model

- The upstream source is **not** a locally initialized submodule: the phone
  has ~1.4 GB free disk, so CI fetches the tarball of the pinned commit
  (`upstream.tarball_url` + `tarball_sha256`) and validates it. The pin is a
  full commit sha, so the fetch is deterministic.
- Toolchain is pinned to what upstream's own `.buildkite/Dockerfile` uses at
  that commit: NDK r27c, LLVM/clang 21.1.8, cmake 3.30.5, node 24.3.0,
  host bun 1.3.13 (codegen), rust `nightly-2026-07-20` (via
  `rust-toolchain.toml` in-tree).
- JavaScriptCore is never compiled: `scripts/build/deps/webkit.ts` downloads
  the official prebuilt (`oven-sh/WebKit` release
  `autobuild-2e2aa229…`, asset `bun-webkit-linux-arm64-android.tar.gz`,
  built against android28). That is why the port's minimum API is **28**.
- Android source adaptations live in `patches/android/*.patch`, applied with
  `git am` over the clean pinned tree. Never a dirty checkout.

## Layout

```
ci/                     source-manifest.json, setup-runner.sh, validate-source-tree.sh,
                        link-ndk-runtimes.sh, build-android.sh
patches/android/        versioned Bionic/Termux patches (see docs/PATCHES.md)
scripts/verify-*.sh     targeted on-device regressions (one per patch)
scripts/battery-device.sh
                        broad on-device battery: 157 cases over 10 tiers (T1–T10)
tests/fixtures/         battery cases + manifest (cases.txt) + shared helpers
tests/parity-probe/     the same surface run against official buns (linux-x64
                        and linux-aarch64) to split "our port" from "upstream"
.github/workflows/
  build-android.yml     workflow_dispatch: host-smoke | android (no publish)
  release-android.yml   workflow_dispatch only: publishes a prior android run
                        (v1.4.2-android.1 published)
  probe-upstream-parity.yml
                        downloads an official bun and runs tests/parity-probe
docs/
  ARCHITECTURE.md       components map + data flow + invariants
  BUILD.md              build recipe, toolchain pins, CI/caches
  PATCHES.md            the eight android patches and the TinyCC quadruple gate
  VERIFY.md             on-device protocol, the T1–T10 battery, evidence format
  RELEASE.md            publication policy and procedure
  STANDALONE.md         measured 1.4.2 `--compile` graph format (M4 bridge input)
  KNOWN-ISSUES.md       measured limitations and diagnostic gotchas
  ROADMAP.md            what's left and the open decisions
  PROGRESS.md           milestone checklist + evidence log (canonical)
```

## Install from the release (Termux)

```sh
gh release download v1.4.2-android.1 --repo Leonisaurov/bun-android \
  -p bun-linux-aarch64-android.tar.gz
sha256sum bun-linux-aarch64-android.tar.gz   # 404c41d38900af50…
tar -xzf bun-linux-aarch64-android.tar.gz
mkdir -p ~/.bun-android/bin
mv bun-linux-aarch64-android/bun ~/.bun-android/bin/bun && chmod +x ~/.bun-android/bin/bun
~/.bun-android/bin/bun --revision              # 1.4.2-canary.1+0c087fdb9
```

Requires API 28+ (JavaScriptCore comes from the official android28 prebuilt).
`docs/VERIFY.md` is the on-device protocol used to accept the build; the
targeted regressions (`scripts/verify-*.sh`) and the battery
(`scripts/battery-device.sh`) run against `$HOME/.bun-android/bin/bun` by
explicit path, never via `PATH`.

## Acceptance rule

A milestone closes only with evidence running **on the phone** (`bun
--version` = 1.4.2, smokes in tmux), recorded in `docs/PROGRESS.md` with
command, sha256 and date. "It compiles" is never sufficient.
