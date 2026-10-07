# bun-android — side project

Port of **Bun v1.4.2** (Rust rewrite; zero `.zig` files) to Android/Bionic,
built from source in our own GitHub Actions. Milestones M0–M4 with
on-device evidence live in [`docs/PROGRESS.md`](docs/PROGRESS.md); all upstream
pins live in [`ci/source-manifest.json`](ci/source-manifest.json).

This is a **side project**. It is deliberately isolated from the
`opencode-termux` workspace, whose Bun port (era-Zig: runtime 1.2.13 +
standalone-graph emitter 1.3.2) is closed and must not be touched from here.

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
patches/android/        versioned Bionic/Termux patches (M1+)
scripts/verify-device.sh  on-device checks (Termux side, never ~/.local/bin)
.github/workflows/build-android.yml  workflow_dispatch: host-smoke | android
docs/PROGRESS.md        milestone checklist + evidence log
```

## Acceptance rule

A milestone closes only with evidence running **on the phone** (`bun
--version` = 1.4.2, smokes in tmux), recorded in `docs/PROGRESS.md` with
command, sha256 and date. "It compiles" is never sufficient.
