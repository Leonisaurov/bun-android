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

## M0 · CI de toolchain verde + smoke host — CERRADO 2026-10-07

- [x] Purge de disco en runner ubuntu-latest.
- [x] Caches `ci-cache-v1-toolchain-*` (NDK recortado, LLVM 21.1.8 tarball de
  GitHub releases, cmake, node, bun host, rustup) y `ci-cache-v1-jsc-*`
  (`--cache-dir` con el prebuilt WebKit).
- [x] Symlinks NDK compiler-rt/libunwind → resource-dir del clang host.
- [x] Valideo del tarball (sha256 + anclajes del árbol 1.4.2; el tarball
  codeload no trae VERSION) y árbol limpio (`git init` baseline + `git am`).
- [x] Build host `--profile=ci-build --os=linux --arch=x64 --lto=false
  --buildkite=false` + `bun --version` del binario emitido.
- [x] Cierre: run verde; tool versions en step summary; `bun --version` rc=0.

**Evidencia de cierre** (run `37632466134`, commit `7ec479c`, 2026-10-07):
- Setup verde: clang 21.1.8, cmake 3.30.5, rustc 1.99.0-nightly
  (nightly-2026-07-20, 9f36de775), NDK r27c en `$TOOL_HOME/android-ndk`,
  runtimes linkeados al resource-dir del clang.
- Configure + grafo ninja (1248 targets) + cargo `release` 9m32s + link y
  strip: `build/release/bun-profile`; `bun-profile --revision` ⇒
  `1.4.2-canary.1+7ec479c45`; `$BIN --version` ⇒ `1.4.2` rc=0.
- WebKit prebuilt (`autobuild-2e2aa229…`, linux-amd64) extraído a
  `~/.cache/bun-build`; caches guardadas: jsc 535 MB y toolchain (keys
  `a916fe9e…` / `1a94fbe0…`).
- Desviaciones de la receta oficial, ambas con motivo: `--lto=false` (solo
  smoke de receta; la línea android usa defaults), `--buildkite=false`
  (el grafo `ci-build` emite edges `buildkite-agent` inexistentes en GHA) y
  entry `bun scripts/build.ts` (upstream rechaza Node <25 para codegen).

### Bitácora de corridas M0 (fallas → fixes, todos commiteados)

| Run | Sha | Falla en | Causa | Fix |
|---|---|---|---|---|
| 37624652911 | d88f70d | Setup | self-extractor Kitware de cmake muere bajo `$TOOL_HOME` (`cd: can't cd`) | distribución `.tar.gz` + `--strip-components=1` (`9ba9f5c`) |
| 37625275857 / 37626025676 | 9ba9f5c / 1c7bf81 | Setup | 404: el release `llvmorg-21.1.8` no publica flavour `clang+llvm…ubuntu`; luego el 404 real era node dist | `LLVM-21.1.8-Linux-X64.tar.xz` extraído fuera de cache (`1c7bf81`); `node-v24.3.0-linux-x64.tar.xz` (`f0764ae`); marcadores `say()` + retries (`f452447`) |
| 37626453157 / 37627000158 | f452447 / f0764ae | Validate | el tarball codeload no trae `VERSION` | valideo por anclajes del árbol + `git init` baseline (`8f3037e`) |
| 37627910507 | 8f3037e | Host build (Configure) | "Node 24.3.0 cannot run the codegen scripts" — exige Node ≥25 o bun | entry point `bun scripts/build.ts` (`aeb56d5`) |
| 37628734461 | aeb56d5 | Host build (Configure) | `nasm not found in toolchain` (Dockerfile upstream lo instala) | apt+: nasm/pkg-config/wget/unzip/make (`060f96f`) |
| 37629973014 | 060f96f | Host build (ninja 168/1251) | `ci-build` implica `buildkite:true` → el grafo emite edges `buildkite-agent artifact upload` (`bun.ts` `registerBkUploadRules`) y el binario no existe en GHA: exit 127 | `--buildkite=false` en ambos builds + `save-always: true` en caches (`7ec479c`) |

Progreso verificado en 37629973014: cargo `release` compiló 6m22s y el WebKit
prebuilt se extraído desde `~/.cache/bun-build`; solo moría el upload edge.

## M1 · primer ELF android desde CI propia — CERRADO 2026-10-07

- [x] `ci/build-android.sh` verde en modo `android` (misma receta oficial:
  `--profile=ci-build --os=linux --arch=aarch64 --abi=android`, más la
  desviación `--buildkite=false` heredada de M0).
- [x] Validationes estáticas: `readelf -h` ELF64/AArch64, `readelf -d`
  NEEDED `libc.so`, sha256. Nota: `OS/ABI` sale `UNIX - System V` (no
  `Android`): es lo que produce el toolchain upstream para android; el
  gate real es que el linker bionic lo cargue en el teléfono (ver abajo).
- [x] Riesgos cc-rs/`__ANDROID_API__`: **no materializados** — el cross-build
  pasó en la primera corrida sin patches (`patches/android/` sigue vacío).
- [ ] Release propia (tarball) vía `workflow_dispatch` (no push).
- [x] Cierre en dispositivo: `~/.bun-android/bin/bun --version` ⇒ `1.4.2`
  rc=0 (no toca `~/.local/bin`).

**Evidencia de cierre**:
- Run `37635152940` (commit `a40e66b`, 2026-10-07): ninja 1211 targets en
  10.68 min; `link bun-profile` + `strip bun`; `readelf`: ELF64 / AArch64 /
  NEEDED `libc.so`; sha256 `5245f48faa50dad2a4b265c7527d0744eace63665869a4ae5db200372b85f209` (288 MB).
- Dispositivo (Termux, 2026-10-07): `verify-device.sh` instaló el artefacto
  en `~/.bun-android/bin/bun`, sha256 idéntico al de CI, y
  `bun --version -> '1.4.2' rc=0`.

Pendiente menor: la release propia se emite cuando el binario merezca ser
distribuido (tras M2/M3); no bloquea el hito.

## M2 · smoke real en Bionic — CERRADO 2026-10-07

- [x] `bun run` de script con `fetch()` (https) en el teléfono.
- [x] `bun:sqlite` SELECT.
- [x] `bun install` de un paquete pequeño.
- [x] Cierre: capturas tmux fechadas en este documento.

**Evidencia** (Termux, tmux 120x32, binario `~/.bun-android/bin/bun`
sha256 `5245f48f…`, 2026-10-07):
- `fetch.ts` (`fetch("https://example.com")`): `fetch status: 200 bytes: 577`
  ⇒ `RC_FETCH=0`.
- `sqlite.ts` (CREATE/INSERT/SELECT en memoria):
  `sqlite rows: [{"x":1,"y":"uno"},{"x":41,"y":"a"}]` ⇒ `RC_SQLITE=0`.
- `bun install` (`ms@2.1.3`): banner `bun install v1.4.2-canary.1 (a40e66be9)`,
  `1 package installed [136.00ms]` ⇒ `RC_INSTALL=0`; `bun run use.mjs` ⇒
  `ms(1000): 1s`, `RC_USE=0`.

## M3 · paridad Termux (parches sobre el stack Rust)

- [x] SIGSYS `openat2`: medido en el teléfono (rc=159 al servir una ruta de
  directorio — `Bun.serve` dir-route llamaba `openat2_in_root`). Patch
  versionado `0001-android-openat2-enosys-fallback.patch` (android → ENOSYS +
  fallback `openat` en `DirectoryRoute`) → rebuild (run `37638826721`, sha
  `0cb32a0d…`) → `scripts/verify-sigsys-device.sh` verde en dispositivo
  (serve 200 "hola-sigsys", spawn, chmod). `fchmodat2`/`close_range`: sin
  SIGSYS medido (chmod y spawnSync correctos; `bun-spawn` ya cae a su loop).
- [x] Heap tagging: **no necesario en esta receta** — estresado en dispositivo
  sin crashes; el ctor `android_disable_heap_tagging` de la era Zig cubría el
  JSC auto-compilado, y aquí el JSC es el prebuilt oficial de upstream.
- [x] `epoll_pwait2`: el `bun_epoll_pwait2` de usockets cachea el fallback a
  `epoll_pwait` ante ENOSYS/E_perm, y en Termux el syscall pasa (fetch/serve
  verdes desde M2, sin SIGSYS) → sin parche.
- [x] RLIMIT_NOFILE: Termux trae 32768/32768 (medido en `/proc/self/limits`);
  el bump a 163840 de la era Zig era para la suite de upstream, no para la
  paridad de smokes → sin parche, se reconsidera si un workload real lo pide.
- [x] cwd/SD-card: `process.cwd()` y escritura en `/storage/emulated/0`
  correctos sin parche (medido 2026-10-07). Gap de rutas real: con `TMPDIR`
  ausente, `node:os` tmpdir caía a `/data/local/tmp` (no escribible por el uid
  de Termux ⇒ mkdtemp EACCES, rojo medido). Patch `0004-android-tmpdir-termux
  -fallback.patch` (fallback a `/data/data/com.termux/files/usr/tmp`, análogo
  del `platformTempDir` zig-era). **Verde en dispositivo 2026-10-07**: run
  `37646043259` (sha artifact `bf7be62a…`, revisión `1.4.2-canary.1+36214c433`)
  → `verify-tmpdir-device.sh`: tmpdir=$PREFIX/tmp y mkdtemp OK;
  `verify-sigsys-device.sh` sigue verde (sin regresión de 0001). Nota: el shim
  `BUN_NODE_DIR` de `bun run` queda en `/data/local/tmp` en builds android
  (solo afecta si un script invoca `node` sin node en PATH; fuera del alcance
  de los smokes).
- [ ] TinyCC: gate triple descubierto — (a) `config.ts`/`deps/tinycc.ts`
  (patch `0002`, habilita el build DirectBuild: fetch + codegen `tccdefs_.h` +
  10 objetos linkeados; la "anomalía" de edges ausentes era truncado del log
  de Actions, verificado por gaps de numeración 187–339/341–1220 donde
  tampoco aparecen los `cxx obj` de bun), (b) `ENABLE_TINYCC` generado en
  `buildOptionsRs.ts` (guard runtime de `cc()` en `ffi_body.rs:998`; patch
  `0003` retira la linea android), (c) **stub `tcc_externs!` en
  `src/tcc_sys/tcc.rs`**: define los `extern "C"` como `unreachable!()` en
  android/freebsd porque upstream no construye libtcc ahí. Con 0003 ya activo,
  el dispositivo paniqueó en `tcc_new` (rc=134, `36214c433`) confirmando el
  stub. Patch `0005-android-tcc-externs-reales.patch` retira android del
  predicado (freebsd intacto; sincronizado con cfg.tinycc/ENABLE_TINYCC como
  exige el comentario del macro). Pin upstream del crate tinycc:
  `oven-sh/tinycc@05f0fafaa3be` (no el 29985a3b zig-era). Pendiente: run
  `37649103236` → `scripts/verify-tinycc-device.sh` en el teléfono.
- [ ] Cierre: cada sub-hito con commit + evidencia en el teléfono.

## M4 · standalone 1.4.2 (proyecto aparte, no planeado aquí)

El grafo 1.4.x se inserta antes de las section headers ELF (`e_shoff`
reubicado, trailer ya no al EOF): reader/ensamblador nuevo en un repo aparte
`bun-opencode-bridge` con round-trip test. No entra en este repo.

## Bitácora

- 2026-10-07: B0 en ejecución; pines verificados (ver manifest); sha256 del
  tarball streammeado: `25e09a8804535b8fbea1dad9f95af8402fc9133d28127d5594ff00df1549590e`.
