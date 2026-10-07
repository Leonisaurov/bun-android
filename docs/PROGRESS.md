# PROGRESS — bun-android (side project, Bun 1.4.2 Rust → Android/Bionic)

Regla de aceptación: un hito se cierra solo con evidencia corriendo en el
teléfono (comando exacto, sha256, salida), nunca "compila". Plantilla de
cierre: comando, sha256 del artefacto, captura (tmux si aplica), fecha.

Pinos y receta: `ci/source-manifest.json` (verificado contra upstream en el
commit pineado, 2026-10-07). El source NO es un submodule inicializado local:
el teléfono tiene ~1.4 GB libres, CI baja el tarball del commit pineado.

## B0 · scaffold del side project

- [x] Repo local `../bun` + remoto GitHub `Leonisaurov/bun-android` (público).
- [x] `ci/source-manifest.json` con pines verificados (bun commit/tag, WebKit
  release+asset+sha256, NDK r27c, LLVM 21.1.8, cmake 3.30.5, node 24.3.0,
  bun host 1.3.13, rust nightly-2026-07-20, API 28) + sha256 del tarball
  (25e09a88…) calculado por streaming.
- [x] Scripts: `ci/setup-runner.sh`, `ci/link-ndk-runtimes.sh`,
  `ci/validate-source-tree.sh`, `ci/build-android.sh`,
  `scripts/verify-device.sh` (instala solo en `~/.bun-android/bin`).
- [x] `.github/workflows/build-android.yml` (dispatch: `host-smoke` | `android`).
- [x] Cierre 2026-10-07: commit `d88f70d` empujado a `Leonisaurov/bun-android`
  (público, creado vía `gh repo create`); run M0 `host-smoke` dispatcheado:
  https://github.com/Leonisaurov/bun-android/actions/runs/37624652911.
  Desviación documentada: source por tarball pineado en CI (no submodule local)
  por el disco del teléfono (~1.4 GB libres); recipes de toolchain copiadas del
  `.buildkite/Dockerfile` del commit pineado (bun host 1.3.13, node 24.3.0,
  NDK r27c recortado, symlinks compiler-rt/libunwind).

## M0 · CI de toolchain verde + smoke host

- [ ] Purge de disco en runner ubuntu-latest.
- [ ] Caches `ci-cache-v1-toolchain-*` (NDK recortado, LLVM 21.1.8 tarball de
  GitHub releases, cmake, node, bun host, rustup) y `ci-cache-v1-jsc-*`
  (`--cache-dir` con el prebuilt WebKit).
- [ ] Symlinks NDK compiler-rt/libunwind → resource-dir del clang host.
- [ ] Valideo del tarball (sha256 + VERSION 1.4.2) y árbol limpio (`git am`).
- [ ] Build host `--profile=ci-build --os=linux --arch=x64 --lto=false`
  (desviación documentada: `-lto` solo acelera el smoke de receta; la línea
  android sí usa defaults oficiales) + `bun --version` del binario emitido.
- [ ] Cierre: run verde; tool versions en step summary; `bun --version` rc=0.

## M1 · primer ELF android desde CI propia

- [ ] `ci/build-android.sh` verde en modo `android` (misma receta oficial:
  `--profile=ci-build --os=linux --arch=aarch64 --abi=android`).
- [ ] Validationes estáticas: `readelf -h` (ELF64/AArch64, OS/ABI UNIX
  Android), `readelf -d` NEEDED `libc.so`, sha256.
- [ ] Riesgos a enfrentar con patches versionados: flags cc-rs en crates
  `*_sys` (`CC_aarch64_linux_android` et al.), mismatch `__ANDROID_API__`
  Rust vs C++.
- [ ] Release propia (tarball) vía `workflow_dispatch` (no push).
- [ ] Cierre en dispositivo: `~/.bun-android/bin/bun --version` ⇒ `1.4.2`
  rc=0 (no toca `~/.local/bin`).

## M2 · smoke real en Bionic

- [ ] `bun run` de script con `fetch()` (https) en el teléfono.
- [ ] `bun:sqlite` SELECT.
- [ ] `bun install` de un paquete pequeño.
- [ ] Cierre: capturas tmux fechadas en este documento.

## M3 · paridad Termux (parches sobre el stack Rust)

- [ ] SIGSYS `openat2`/`fchmodat2`/`close_range`: medir soporte del kernel
  5.10 del teléfono antes de parchear; port de los fallbacks del port Zig.
- [ ] cwd/SD-card Termux (análogo Rust del fix de rutas).
- [ ] Heap tagging: equivalentes del patrón `android_disable_heap_tagging`
  (ctor `.init_array`/option mimalloc) + test propio en dispositivo.
- [ ] TinyCC: reactivar android con el build cruzado portado
  (`oven-sh/tinycc@29985a3b`) + cierre con NAPI/FFI.
- [ ] Cierre: cada sub-hito con commit + evidencia en el teléfono.

## M4 · standalone 1.4.2 (proyecto aparte, no planeado aquí)

El grafo 1.4.x se inserta antes de las section headers ELF (`e_shoff`
reubicado, trailer ya no al EOF): reader/ensamblador nuevo en un repo aparte
`bun-opencode-bridge` con round-trip test. No entra en este repo.

## Bitácora

- 2026-10-07: B0 en ejecución; pines verificados (ver manifest); sha256 del
  tarball streammeado: `25e09a8804535b8fbea1dad9f95af8402fc9133d28127d5594ff00df1549590e`.
