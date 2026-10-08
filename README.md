# bun-android — side project

Port of **Bun v1.4.2** (Rust rewrite; zero `.zig` files) to Android/Bionic,
built from source in our own GitHub Actions. Milestones M0–M4 plus the broad
on-device audits — A1 surface, A2 surface extension + upstream parity
classification, A3 product-surface tier T10 classified the same way, A4
root-cause of the libtcc SIGSEGV with a verified workaround — live in
[`docs/PROGRESS.md`](docs/PROGRESS.md); all upstream pins live in
[`ci/source-manifest.json`](ci/source-manifest.json).

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

## Acceptance rule

A milestone closes only with evidence running **on the phone** (`bun
--version` = 1.4.2, smokes in tmux), recorded in `docs/PROGRESS.md` with
command, sha256 and date. "It compiles" is never sufficient.
