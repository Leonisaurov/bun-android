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
- [ ] Release propia (tarball) vía `workflow_dispatch` (no push). Mecanismo
  listo desde 2026-10-07: `.github/workflows/release-android.yml` (consume el
  artifact `bun-aarch64-android` de un run android previo; política y
  procedimiento en `docs/RELEASE.md`). Pendiente solo el dispatch, que crea
  la release pública.
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

## M3 · paridad Termux (parches sobre el stack Rust) — CERRADO 2026-10-07

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
  de los smokes). **Portado en A1**: ese "fuera del alcance" resultó rojo real
  y lo cierra el parche `0007` (ver hito A1 abajo).
- [ ] TinyCC: gate cuádruple descubierto — (a) `config.ts`/`deps/tinycc.ts`
  (patch `0002`, habilita el build DirectBuild: fetch + codegen `tccdefs_.h` +
  10 objetos linkeados; la "anomalía" de edges ausentes era truncado del log
  de Actions, verificado por gaps de numeración 187–339/341–1220 donde
  tampoco aparecen los `cxx obj` de bun), (b) `ENABLE_TINYCC` generado en
  `buildOptionsRs.ts` (guard runtime de `cc()` en `ffi_body.rs:998`; patch
  `0003` retira la linea android), (c) **stub `tcc_externs!` en
  `src/tcc_sys/tcc.rs`**: define los `extern "C"` como `unreachable!()` en
  android/freebsd porque upstream no construye libtcc ahí — con 0003 activo
  el dispositivo paniqueó en `tcc_new` (rc=134, build `36214c433`); patch
  `0005` retira android del predicado (freebsd intacto). Con 0005 (build
  `b244355df`, sha `e82cbf78…`) `tcc_new` corre y compila, pero falla en
  runtime con (d) **`tcc: error: library 'c' not found`**: `tcc_add_runtime`
  de libtcc añade `-lc` salvo `nostdlib`, y en Termux no existen los dirs
  FHS que busca (`/usr/lib`, …). Los defaults zig-era 1.2.13 ya pasaban
  `-nostdlib` (`ffi.zig:1501`) y el camino napi de 1.4.2 (`Function::compile`)
  también lo usa internamente — patch `0006` alinea los dos sitios de
  `CompileC` (`DEFAULT_TCC_OPTIONS` y el fallback de `compile()`). Pin
  upstream del crate tinycc: `oven-sh/tinycc@05f0fafaa3be` (no el 29985a3b
  zig-era). **Verde en dispositivo 2026-10-07** con run `37652505142`
  (patches 0001–0006; sha artifact `899866c5…`, revisión
  `1.4.2-canary.1+c23b9c226`): `verify-tinycc-device.sh` ⇒ `cc add3(1,2,3)
  = 6`, rc=0. Limitación portada (igual que zig-era): sin stdlib, código C
  que referencie símbolos libc requiere resolución adicional; fuera del
  smoke de paridad.
- [x] Cierre 2026-10-07: seis patches versionados (`0001` openat2, `0002`
  tinycc config/defines, `0003` ENABLE_TINYCC codegen, `0004` tmpdir Termux,
  `0005` tcc_externs reales, `0006` tcc -nostdlib) aplicados por CI con
  `git am`. Batería completa en el teléfono con `899866c5…` sin regresiones:
  `verify-sigsys` OK (serve 200/spawn/chmod), `verify-tmpdir` OK,
  `verify-tinycc` OK, y smokes M2 repetidos — `fetch` 200, `bun:sqlite`
  `select 40+2` ⇒ 42, `bun add ms` ⇒ ms@2.1.3 y `ms(1000)` ⇒ `1s`. Binario
  instalado solo en `~/.bun-android/bin` (no toca `~/.local/bin`).

## M4 · standalone 1.4.2 (proyecto aparte, no planeado aquí)

El grafo 1.4.x ya no es un trailer al EOF (confirmado por medición abajo:
sección `.bun` + blobs enlazados dentro de `PT_LOAD`): reader/ensamblador
nuevo en un repo aparte `bun-opencode-bridge` con round-trip test. No entra
en este repo.

### M4-preliminar · sonda `--compile` en el teléfono — MEDIDA 2026-10-07

Sonda de factibilidad (plan `stoic-swamp-karp` re-enfocado; no toca el port
cerrado ni construye opencode) con el bun 1.4.2 instalado (sha `899866c5…`)
en `$PREFIX/tmp/m4-probe/`, bajo `tcr`. Comandos y resultados:

- `bun build --compile ./app.mjs --outfile probe` ⇒ **rc=0** (`[12ms] bundle
  1 modules`, `[1069ms] compile`). `./probe` ⇒ rc=0, salida `probe 42`;
  `./probe hola-mundo` ⇒ `arg: hola-mundo`. **`--compile` funciona en
  android/bionic con nuestros parches** (el riesgo upstream #38246 no se
  materializó en este binario).
- `bun add ms` (rc=0, ms@2.1.3) + `bun build --compile ./app2.mjs` ⇒ rc=0,
  `./probe2` ⇒ rc=0 `dep-probe 1s`: **empaqueta node_modules** (2 modules).
- Layout medido del ELF generado (`probe`, 291.299.504 B): NO hay trailer al
  EOF — la tabla de section headers termina exactamente en EOF
  (`e_shoff=291296624`, 45×64 B ⇒ fin=EOF). El grafo va **dentro de la
  imagen**: descriptor en la sección `.bun` (0xfa B en `0x54c0000`: u64
  longitud + fuente `// @bun…`) y los módulos embebidos como datos estáticos
  (en `probe2` la ruta `node_modules/ms` aparece como string en `0x54C04F7`,
  dentro del LOAD RW). Es decir, 1.4.2 no "pega un grafo al final": lo
  **enlaza** — un ensamblador estilo era-Zig (append + scan de magic al EOF)
  es estructuralmente insuficiente; el bridge M4 tiene que modelar la
  sección/`PT_LOAD`, no un footer.
- Nota de tamaño: `probe` de una hello-world pesa 291 MB porque el runtime
  embebido conserva las secciones `.debug_*` (~190 MB) del perfil ci-build.
  Para un standalone útil el bridge va a necesitar strip.
- sha256 de los sondas: `probe` `a9a939f3…`, `probe2` `108d8529…` (scratch
  regenerable; ELF grandes eliminados del teléfono tras medir, 4,4 GB libres).

**Veredicto**: sonda verde en las tres preguntas (compila, corre, empaqueta
deps). El puente M4 sigue siendo proyecto aparte, ahora con formato objetivo
medido: parser de grafo 1.4.x = lectura de sección `.bun` + blobs en
`PT_LOAD`, no trailer EOF.

## A1 · auditoría amplia de superficie (T1–T8) — CERRADO 2026-10-07

Hito disparado por la sospecha del usuario: M3 se cerró con **cuatro smokes
dirigidos** (uno por parche) y una sonda `--compile`, o sea que la superficie
afirmada nunca se midió en bulk. A1 mide la superficie real del ELF en
Termux, diagnostica cada rojo con causa, parchea solo lo nuestro y re-mide
completo por regresiones. Protocolo y flags del runner en
[`VERIFY.md` · Batería amplia](VERIFY.md); política de rojos aceptados en
[`KNOWN-ISSUES.md`](KNOWN-ISSUES.md).

Artefactos del hito: `scripts/battery-device.sh` + `tests/fixtures/`
(97 casos en 8 tiers, manifiesto `cases.txt`, helpers `lib.mjs`), gate real
del workflow de release, y el parche `0007`.

### Fix del gate de release (no requería teléfono para demostrar)

`release-android.yml` exigía `grep -Eq 'OS ABI: +UNIX Android'`, pero `readelf`
imprime `OS/ABI:` (con barra) y el toolchain upstream marca el ELF android como
`UNIX - System V` — ya documentado en M1. El gate era **irremplazablemente
falso**: ningún dispatch de release podía pasar. Reemplazado por las validaciones
que la herramienta produce de verdad (`OS/ABI: +UNIX - (System V|GNU|Android)`,
`Type: DYN`, `DT_NEEDED libc.so`) y se añadió `evidence_ref` obligatorio al body
de la release (commit `86887bb`; no se despachó ninguna release).

### Falso verde de metodología, corregido antes de afirmar nada

La sonda rápida inicial (14 casos: `node:crypto`, `zlib`, `Buffer`, streams,
`Worker`, `sqlite` WAL, `execFileSync`, `Intl es-AR`) se midió con pipes a
`tail`, así que los `rc` leídos eran los de `tail`. `${PIPESTATUS[0]}` no existe
bajo el wrapper `sh -c` de Termux. El runner corre el binario **sin pipe** y lee
el rc del proceso de bun. Ningún número de abajo viene de esa sonda.

### Línea base — binario `899866c5…` (run `37652505142`), sin rebuild

sha256 `899866c5ed7f7a74893e0ad7251e875f83001938871313aa4502a84413910588`,
`bun --revision` ⇒ `1.4.2-canary.1+c23b9c226`, 3.897 MB libres al inicio.
Corridas por oleada (logs en `$PREFIX/tmp/battery-logs/`):

| Oleada | Log | resultado | Nota |
|---|---|---|---|
| T3+T4 | `t34-220653.log` | 28/28 PASS | — |
| T5+T6 (1ª) | `t56.log` | 9 PASS, 4 FAIL, 1 KNOWN, 1 SKIP, 1 KNOWN-PASS | los 4 FAIL eran **bugs de mis fixtures** (`ms(90000)` es `"2m"`; `eq()` sobre arrays compara referencias; `new Request(response)` pide url; un ELF pasado por `self()` → `Unexpected \x7f`), no del binario |
| T5 fix + T7 | `t57.log` | 12 PASS, 1 FAIL | el FAIL es `run_script_node_shim`: rojo **real** |
| T8 | `t8.log` | 14 PASS, 1 FAIL | `spawn_flood_50`: fixture (leía un Promise de stdout), no binario |
| T1+T2+T5+T8 consolidado | `base-t1258.log` | 56 PASS, 1 FAIL, 2 KNOWN | único FAIL el del shim |

Matriz base consolidada (97 casos):

| Tier | casos | PASS | FAIL | KNOWN | SKIP |
|---|---|---|---|---|---|
| T1 CLI | 16 | 16 | — | — | — |
| T2 node compat | 18 | 17 | — | 1 (`dns_promises_resolve` cuelga) | — |
| T3 http/red | 16 | 16 | — | — | — |
| T4 storage | 12 | 12 | — | — | — |
| T5 install/build | 10 | 8 | **1** (`run_script_node_shim`) | 1 (`install_removes_pruned_dep`) | — |
| T6 FFI/TinyCC | 6 | 4 | — | 1 (`cc_libc_reference_limitation`) | 1 (attempt JSCallback) |
| T7 `--compile` | 4 | 4 | — | — | — |
| T8 edges Termux | 15 | 15 | — | — | — |
| **total** | **97** | **92** | **1** | **3** | **1** |

### Triage del rojo único

Árbol de decisión: no es limitación de entorno compartida con el oráculo —
`/data/local/tmp` no es escribible por el uid de Termux,
`create_fake_temporary_node_executable` hace `mkdir(..., 0o700)` y ante el error
**devuelve `Ok(())` sin inyectar el shim** (`src/install/lib.rs:588-603`), así
que `bun run <script>` que invoca `node` muere 127 en silencio. Es nuestra
cancha (mismo target que el fix `0004` de tmpdir, y `BUN_NODE_DIR` era el gap
que M3 había dejado a propósito como candidato 0007) → **parche**, no doc.
Fixture reforzado: corre con un PATH **privado y vacío**, porque con
`$PREFIX/bin` dentro pasaba usando el `node` real de Termux (falso verde).

### Loop de fix y re-test completo (regresiones)

`patches/android/0007-android-node-shim-dir-termux.patch` (una hunk en
`src/install/lib.rs`, generado desde un árbol mínimo en `$PREFIX/tmp` con
baseline upstream **antes** de editar, regla de `PATCHES.md`). Commit `39338cc`
→ push → `build-android.yml` mode=`android` run **`37727225410`** (success) →
artifact `bun-aarch64-android` 289.368.016 B, sha256
`31392bdeb78b99591da54a4d468037b5661e8e27bd109f60982e8b368de37e70`,
`bun --revision` ⇒ `1.4.2-canary.1+39338cc1c`. Instalado en
`~/.bun-android/bin/bun` y `~/.local/bin/bun` con sha idéntico al de CI; el
oráculo `$PREFIX/bin/bun` (1.3.14) intacto. 3.211 MB libres durante la
re-medición.

Con el binario nuevo, en la misma logfile: `verify-sigsys` `rc=0`,
`verify-tmpdir` `rc=0`, `verify-tinycc` `rc=0`, y batería completa T1→T8
(`post0007.log`, `post0007.json`):

| Tier | casos | PASS | FAIL | KNOWN | SKIP | vs base |
|---|---|---|---|---|---|---|
| T1 | 16 | 16 | — | — | — | igual |
| T2 | 18 | 17 | — | 1 | — | igual |
| T3 | 16 | 16 | — | — | — | igual |
| T4 | 12 | 12 | — | — | — | igual |
| T5 | 10 | 9 | — | 1 | — | **shim verde**, sin regresión |
| T6 | 6 | 4 | — | 1 | 1 | igual |
| T7 | 4 | 4 | — | — | — | igual |
| T8 | 15 | 15 | — | — | — | igual |
| **total** | **97** | **93** | **0** | **3** | **1** | `battery_rc=0`, **0 rojos nuevos** |

### Criterio nuevo que salió de la auditoría

Un "repro" de terceros se **vuelve a medir acá** antes de parchear: dos
subagentes reportaron un SIGSEGV reproducible en `bun x`, un techo de
`RLIMIT_NOFILE` de 176 y una corrección de fd "aplicada" al harness — nada de
eso estaba en el árbol (el `grep` de `lib.mjs` lo negó) y la sonda propia dio
8/8 `rc=0`. Receta portada a `KNOWN-ISSUES.md`.

**Estado del port tras A1**: 7 parches versionados, 93/97 casos verdes en
dispositivo, 3 limitaciones aceptadas con evidencia y 1 SKIP voluntario. Sigue
fuera de lo afirmado: suite upstream, bundler/plugin API, NAPI nativo,
rendimiento y el puente M4. El dispatch de `release-android.yml` **no** se
ejecutó (requiere autorización explícita del usuario).

## A2 · extensión de superficie y clasificación con upstream (T1–T9) — CERRADO 2026-10-08

**Objetivo declarado por el usuario tras A1**: "extiende los test, tiene que
todo quedar en verde y funcionar como se espera". A1 cerró 97 casos; A2 mide
superficie que la batería no tocaba y, sobre todo, **clasifica** cada rojo
contra el bun oficial de upstream (job `probe-upstream-parity`) para que ningún
`KNOWN` quede "por dicho".

### Qué se sumó (97 → 126 casos, red de 29)

- **T9 · APIs de producto** (tier nuevo): `Bun.Transpiler` (loaders, minify,
  `scanImports`), `Bun.password` (bcrypt + argon2id, incluido el throw con
  hash malformado) y los dos gaps propios de 1.4.x (`EventSource`, handlers
  globales de worker).
- T1: `argv0` propio en `Bun.spawn`, `stdout` hacia `Bun.file`.
- T2: `node:net`, `node:dgram` UDP, `node:tls` server+client, `SharedArrayBuffer`
  + `Atomics.wait/notify` cross-worker, `BroadcastChannel` main↔worker,
  `createRequire` con rutas, `readline` sobre stdin, `fs.cpSync`/`readdir`
  recursivo con symlinks, pipeline `zlib` gzip→archivo.
- T3: TLS real con CA fijada, rechazo del self-signed por default, lectura de
  un stream SSE sobre `fetch`.
- T4: round-trips de compresión nativa (`gzip`/`deflate`/`zstd`, niveles),
  `Bun.file.slice` con offsets sobre 32 MB + `Bun.hash` del file vs buffer.
- T5: `bun test` (rc con un fallo), `--frozen-lockfile` + `bun pm ls`,
  `--preload` con `.env`.
- T8: TZ/IANA con DST (Buenos Aires, Londres, Santiago y el `RangeError` de
  una zona inexistente), señal SIGINT a hijo con exit code propio.
- T6: reescrito a lo medido — receta de libc por `flags` y por
  `BUN_TCC_OPTIONS`, cobertura real de headers bionic y el crash aislado en
  hijo (4 casos donde había 1).

### Falsos rojos del harness que hay que registrar

Ninguno era un bug del port, y todos se midieron antes de tocar el fixture:

- `BroadcastChannel` main↔worker colgaba 15 s: **carrera**, el listener del
  worker no estaba registrado cuando el main posteaba. Sincronía por
  `parentPort` ("listo") y verde.
- `Bun.password.verifySync(usuario, "no-un-hash")`: se afirmaba `false` y
  **lanza** `UnsupportedAlgorithm` (igual en el oráculo 1.3.14) ⇒ el fixture
  ahora afirma el throw.
- `minify` del transpiler: se asumió que renombra la función exportada;
  renombra los **parámetros**. Aserciones derivadas del patrón, no del nombre.
- `cc({ source: "…código…" })`: en 1.4.x el input hay que pasarlo **como
  archivo `.c`**; con el código inline tcc lo trata como ruta y da
  `file '…' not found`.
- El `rc` de la logfile: lanzar la batería con un wrapper que imprimía su
  propio status enmascaraba el del runner (exit 0 sin sello). Hoy la receta de
  `VERIFY.md` hace `echo rc=$?` **dentro** del `sh -c`, y esta corrida quedó
  sellada `BATTERY_DONE rc=0`.

### Línea base y matriz final (mismo ELF, sin rebuild)

`~/.bun-android/bin/bun` sha256 `31392bdeb78b99591da54a4d468037b5661e8e27bd109f60982e8b368de37e70`,
`bun --revision` ⇒ `1.4.2-canary.1+39338cc1c` (build del run `37727225410`,
parche 0007 — el mismo binario con el que cerró A1). Logfile
`$PREFIX/tmp/battery-logs/a3-full.log` / `a3-full.json`, 13.962 MB libres.

| Tier | casos | PASS | FAIL | KNOWN | vs A1 |
|---|---|---|---|---|---|
| T1 CLI | 18 | 18 | — | — | +2 |
| T2 node compat | 27 | 26 | — | 1 | +9 |
| T3 http/TLS | 19 | 19 | — | — | +3 |
| T4 storage | 14 | 14 | — | — | +2 |
| T5 install/build | 13 | 12 | — | 1 | +3 |
| T6 FFI/TinyCC | 9 | 8 | — | 1 | +3 net (la limitación pasó a verde) |
| T7 `--compile` | 4 | 4 | — | — | igual |
| T8 edges Termux | 17 | 17 | — | — | +2 |
| T9 APIs producto | 5 | 3 | — | 2 | tier nuevo |
| **total** | **126** | **121** | **0** | **5** | **0 FAIL, 0 TIMEOUT, 0 SKIP, 0 UNEXPECTED** |

Cierre: `PASS=121 FAIL=0 TIMEOUT=0 SKIP=0 KNOWN=5 UNEXPECTED=0`,
`BATTERY_DONE rc=0`. Los cuatro verificadores dirigidos siguen verdes (T1–T9
incluye sus superficies). El oráculo `$PREFIX/bin/bun` (1.3.14) intacto.

### Clasificación de los 5 KNOWN (sonda upstream, runs `37776390386` y `37780014509`)

Oficial `bun-linux-x64` 1.4.2, revisión `1.4.2+744846f84`, sha
`a83d263767d8…`; referencia adicional `node` v26.

| Caso | upstream linux-x64 | Veredicto |
|---|---|---|
| `T9/eventsource_global_available` | indefinido igual acá | gap de la línea 1.4.x, sin parche |
| `T9/worker_bare_onmessage_global` | hang idéntico (Node lanza `ReferenceError`) | gap de 1.4.x, sin parche |
| `T5/install_removes_pruned_dep` | dep sigue materializada | comportamiento upstream, sin parche |
| `T2/node_dns_raw_resolve` | **OK** (`["104.20.23.154", …]`) | entorno Termux: sin `/etc/resolv.conf` ni `net.dns*`; el resolver crudo no tiene a quién preguntar |
| `T6/cc_headers_bionic_con_crash` | sin equivalente (los headers son de bionic) | limitación del tinycc vendored que re-habilitó el patch 0002; no es código de nuestros parches |

### Decisión de port: no hubo parche 0008

La única limitación que era "nuestra por diseño" (`cc()` sin libc) se resolvió
midiendo, no parcheando: `flags: "-L/apex/com.android.runtime/lib64/bionic -lc"`
por llamada y `BUN_TCC_OPTIONS` para todo el proceso (`src/runtime/ffi/ffi_body.rs:616-623`)
dejan `getpid()`/`strlen()` resueltos y coincidentes con el proceso, y los casos
están verdes. Un default sin `-nostdlib` **rompería** API 28 sin namespace APEX
(`library 'c' not found` ya no tendría arreglo), así que el default deliberado
se queda y la receta se documenta en `KNOWN-ISSUES.md`. Lo que sí quedó abierto
con evidencia es el SIGSEGV de libtcc con headers bionic compuestos: es trabajo
de la dependencia vendored (un ciclo de CI por hipótesis), no de este loop.

**Estado del port tras A2**: 7 parches versionados, 126 casos en 9 tiers, 121
verdes, 5 rojos **todos con causa atribuida** (2 de upstream 1.4.x, 1 de
comportamiento upstream, 1 del entorno Termux, 1 de la dependencia tinycc), 0
FAIL/TIMEOUT/SKIP/UNEXPECTED. Sigue fuera de lo afirmado: suite upstream,
bundler/plugin API, NAPI nativo, rendimiento y el puente M4. `release-android.yml`
**no** se dispatcheó (requiere autorización explícita).

## A3 · superficie de producto (T10) y clasificación de los stubs — CERRADO 2026-10-08

A2 cerró con 5 rojos atribuidos; la meta del usuario seguía abierta ("extiende
los test, tiene que todo quedar en verde"). A3 mide la superficie que ningún
tier tocaba —las APIs de producto de `Bun.*` y los restos del runner— y, antes
de afirmar nada, **sondea**: nueve scripts (`$PREFIX/tmp/a3-probe*.mjs`)
ejecutados en el ELF del dispositivo produjeron cada forma y cada valor que
hoy está assertado. Ningún caso de T10 salió de la documentación.

### Qué se sumó (126 → 153 casos, tier T10 de 27)

**T10 · superficie de producto y del runner** (tier nuevo):

- Serializadores: `Bun.TOML`/`YAML`/`JSON5` con `parse`+`stringify`, y
  `Bun.JSONL`, que **no tiene `stringify`** — su segunda clave es `parseChunk`
  y devuelve `{values, read, done, error}`, no un array.
- `Bun.XML.stringify`/`parse` (en 1.3.14 el namespace no existe), `Bun.zstd*`
  sync y async (5.600 B repetitivos → 32 B; nivel 1 y 19 idénticos),
  `Bun.semver.order/satisfies`, `Bun.deepEquals`/`deepMatch` — y la dirección
  real de `deepMatch`: el **primer** argumento es el patrón, y los arrays no
  son subconjuntos (`{arr:[1]}` no matchea `{arr:[1,2]}`).
- ANSI sobre códigos reales (`stringWidth("\x1b[31mrojo\x1b[0m")=4`,
  `sliceAnsi` re-cierra el color con `\x1b[39m`), `Bun.peek`, `Bun.cron`,
  `Bun.mmap(path)` → `Uint8Array` sobre el archivo (las formas `mmap(n, path)`
  y `mmap(path, offset, len)` **throw**: "Expected a path" / "Expected options
  to be an object").
- Sockets **unix** en Bionic: `Bun.serve({unix})` (`s.url` = `unix:///…`,
  `port` undefined) con `fetch(..., {unix})`, y `Bun.listen({unix, socket})`
  respondiendo a un cliente `node:net` (`ECO:hola-unix`) — incluido HTTP/1.1
  crudo por el mismo socket. `bun --watch` recarga con los fs events de
  Termux (RUN-1 → RUN-2).
- `node:vm` completo (13 exportaciones, `runInContext`/`runInNewContext` con
  su cross-realm), `Bun.Glob` (`scan` async, `scanSync` **generador**),
  import attributes `file`/`text` (el primero devuelve **la ruta absoluta**, no
  el contenido), `await using` + `Symbol.asyncDispose`.
- Runner y API: `bun test` con `mock`/`spyOn`/`--coverage`, `db.loadExtension`
  en hijo (throw sin matar), `Bun.dns.getServers()`, `Bun.isStandaloneExecutable`
  y `Bun.embeddedFiles` fuera de un `--compile`, `Bun.sha` vs `CryptoHasher`
  con valores fijos.
- WebCrypto (`ECDSA P-256` sign/verify, `HKDF-SHA256`) e Intl (`Collator` `es`
  sensibilidad `base` sobre "ñoño"/"nono", `PluralRules` `es-AR`).

### Falsos rojos del harness (otra clase, misma regla: medir antes de assertar)

- `eq()` compara **identidad**. Tres casos nacieron rojos imprimiendo
  `got [-1,1,0] want [-1,1,0]`. Se agregó `eqJSON()` (comparación por JSON) y
  una pista en el mensaje de `eq` para que la próxima vez no se lea como rojo
  del binario.
- Cross-realm: `runInNewContext` devuelve arrays del realm del script; `===`
  con un array literal del fixture no puede funcionar. Mismo error con
  `scanSync`, que es generador y había que materializarlo.
- `import()` con un specifier relativo resuelve contra el **módulo del
  fixture** (`tests/fixtures/`), no contra el scratch del caso; la receta es
  `pathToFileURL(abs).href`.
- El registro de módulos cachea **por specifier**: importar el mismo URL con
  otro attribute (o con `#fragmento`) devuelve el primer módulo resuelto.
  Tapado primero con dos archivos distintos y después pinned con un caso
  propio (`import_mismo_specifier_con_otro_attribute_devuelve_la_cacheada`).
- `bun:test` **no** exporta `spy` (exporta `spyOn`); un probe que lo importaba
  daba `rc=1` por SyntaxError y se leía como gap de cobertura.
- `bun test --coverage` con todo verde sale `rc=0` y **no imprime tabla de
  porcentajes** — idéntico en el oráculo 1.3.14.

### Línea base y matriz final (mismo ELF, sin rebuild)

`~/.bun-android/bin/bun` sha256 `31392bdeb78b99591da54a4d468037b5661e8e27bd109f60982e8b368de37e70`,
`bun --revision` ⇒ `1.4.2-canary.1+39338cc1c` (run `37727225410`, parche 0007 —
el mismo binario de A1 y A2; la batería creció, el port no se tocó). Logfile
`$PREFIX/tmp/battery-logs/a4-full.log` / `a4-full.json`, 13.817 MB libres.

| Tier | casos | PASS | FAIL | KNOWN | vs A2 |
|---|---|---|---|---|---|
| T1 CLI | 18 | 18 | — | — | igual |
| T2 node compat | 27 | 26 | — | 1 | igual |
| T3 http/TLS | 19 | 19 | — | — | igual |
| T4 storage | 14 | 14 | — | — | igual |
| T5 install/build | 13 | 12 | — | 1 | igual |
| T6 FFI/TinyCC | 9 | 8 | — | 1 | igual |
| T7 `--compile` | 4 | 4 | — | — | igual |
| T8 edges Termux | 17 | 17 | — | — | igual |
| T9 APIs producto | 5 | 3 | — | 2 | igual |
| T10 producto + runner | 27 | 23 | — | 4 | tier nuevo |
| **total** | **153** | **144** | **0** | **9** | **0 FAIL, 0 TIMEOUT, 0 SKIP, 0 UNEXPECTED** |

Cierre: `PASS=144 FAIL=0 TIMEOUT=0 SKIP=0 KNOWN=9 UNEXPECTED=0`,
`BATTERY_DONE rc=0`. Los cuatro verificadores dirigidos siguen verdes y ningún
tier anterior perdió un verde (regresión completa T1→T10 sobre el mismo ELF).
El oráculo `$PREFIX/bin/bun` (1.3.14) intacto.

### Los 4 stubs nuevos: medidos en el dispositivo **y** en el oficial

Cada uno reproduce byte a byte en el `bun-linux-x64` 1.4.2 oficial (sonda
`probe-upstream-parity`, run `37787168311`, revisión `1.4.2+744846f84`) y tres
de ellos también en el oráculo Android 1.3.14:

| Caso | dispositivo (nuestro ELF) | upstream linux-x64 | Veredicto |
|---|---|---|---|
| `T10/archive_zip_roundtrip_real` | `write` crea 10.240 B con magic `"fi"`, `.files` lista 0 entradas | **ROJO idéntico** (`magic=fi size=10240`) | stub de upstream, sin parche |
| `T10/image_resize_y_encode` | `width/height` = `-1×-1`, `encode` no devuelve nada; `Image.backend="bun"` | **ROJO idéntico** (`dims=-1x-1`) | stub de upstream, sin parche |
| `T10/csrf_verify_con_el_mismo_secret` | `generate` da 86 chars, `verify` con el mismo secret → `false` | **ROJO idéntico** | stub de upstream, sin parche |
| `T10/index_of_line_con_string_con_newline` | string → `-1`, `Buffer` → `4` | **ROJO idéntico** (`string=-1`) | gap de upstream con string, sin parche |

Y con la misma sonda quedaron atribuidas dos afirmaciones más que antes eran
"dito del teléfono": `coverage_tabla_en_bun_test` sale **ROJO en linux-x64**
(tampoco imprime tabla ahí ⇒ no es limitación del build Android, como se había
hipotetizado) y `sqlite_load_extension` falla con el mismo
`undefined symbol: sqlite3_sqlite3_init` apuntando a `libsqlite3.so` del host,
más `import_attribute_cache_por_specifier`, que es comportamiento upstream.

### Clasificación final de los 9 KNOWN

| Caso | causa | evidencia |
|---|---|---|
| `T2/node_dns_raw_resolve` | entorno Termux (sin `/etc/resolv.conf` ni `net.dns*`) | upstream OK; acá `Bun.dns.getServers()` = `["127.0.0.1"]` — el resolver crudo pregunta al dnsproxyd de Android en loopback y **nunca recibe respuesta** (`Bun.dns.resolve({verb:true})` lanza `queryA ETIMEOUT` a los ~21 s), mientras `lookup()` por getaddrinfo sí resuelve |
| `T5/install_removes_pruned_dep` | comportamiento upstream | sonda linux-x64, runs `37776390386`/`37780014509` |
| `T6/cc_headers_bionic_con_crash` | bug latente de la libtcc vendored, sensible a layout de memoria | disparador medido: `#pragma once` + segundo include con el **mismo basename**; el repro sintetico sega **20/20** en este ELF, **13/20** en el `bun-linux-aarch64` OFICIAL y **12/20** en el `bun-linux-x64` OFICIAL (runs `37792716755`/`37793508977`/`37793514722`/`37794547875`) ⇒ upstream, no del port. Receta verde y medida: shadow-dir sin el pragma (`T6/cc_pragma_once_colision_de_basename_con_recipe`) |
| `T9/eventsource_global_available` | gap 1.4.x | indefinido en upstream |
| `T9/worker_bare_onmessage_global` | gap 1.4.x | hang idéntico en upstream; Node lanza `ReferenceError` |
| `T10/archive_zip_roundtrip_real` | stub de upstream | tabla anterior |
| `T10/image_resize_y_encode` | stub de upstream | tabla anterior |
| `T10/csrf_verify_con_el_mismo_secret` | stub de upstream | tabla anterior |
| `T10/index_of_line_con_string_con_newline` | gap de upstream (ruta string) | tabla anterior |

Nueve de nueve con causa medida. Ocho son de upstream/entorno y **ninguno**
toca código de `patches/android/`; el restante (`T6/…`) quedó atribuido en A4
con tasas medidas contra los oficiales x64 y aarch64 y con receta verde.

### Decisión de port: ni parche 0008 ni 0009

Con 153 casos y 0 FAIL, no hay ninguna señal de regresión nuestra, y la regla
del plan sigue vigente: lo que reproduce igual en upstream o en el oráculo se
documenta, no se parchea. Parchear un stub de `Bun.Archive`/`Bun.Image`/
`Bun.CSRF` sería mantener fork de código de producto que el port no introduce.

**Estado del port tras A3**: 7 parches versionados, 153 casos en 10 tiers, 144
verdes, 9 rojos **todos con causa atribuida por sonda** (5 stubs/gaps de
upstream 1.4.x, 2 comportamiento upstream, 1 entorno Termux, 1 tinycc
vendored), 0 FAIL/TIMEOUT/SKIP/UNEXPECTED, regresión completa sellada sobre un
ELF que no cambió desde A1. Sigue fuera de lo afirmado: suite upstream,
bundler/plugin API, NAPI nativo, rendimiento y el puente M4.
`release-android.yml` **no** se dispatcheó (requiere autorización explícita).
(Esta matriz queda **superada por A4**: 155 casos / 146 verdes.)

## A4 · causa raíz del crash de libtcc, receta verde y atribución por tasa — CERRADO 2026-10-08

A3 cerró con el `T6/cc_headers_bionic_con_crash` como "dependencia vendored,
abierto como trabajo de tinycc". La meta pedía verde o causa medida; A4 hace
las dos cosas: acota el disparador mínimo, deja una **receta verificada como
caso verde** de la batería, y atribuye contra los binarios OFiciales con
tasas.

### Qué se midió (serie de sondas `a5*` en `$PREFIX/tmp`, en el ELF del dispositivo)

- **Disparador**: libtcc sega (rc=139) cuando un archivo cuyo **basename** es
  `X` lleva `#pragma once` **y** trae por debajo otro archivo con el mismo
  basename `X`. La ruta real de bionic lo pica siempre: `errno.h` (pragma) →
  `linux/errno.h` → `asm/errno.h` → `asm-generic/errno.h`. Sin el pragma la
  misma cadena compila; con pragma pero basename distincto también.
- **Descartado por medición**: la hipótesis `_Nonnull`, las flags (crashea
  igual con `-I` sola, con `-L… -lc`, con `-nostdlib`), y un `CONFIG_TCCDIR`
  inexistente como parte del ciclo.
- **Gaps hermanos del mismo preprocessor**: tcc sirve `stddef.h`/`stdarg.h`
  como headers embebidos pero **no** `float.h` ni `iso646.h` (bionic
  `limits.h:58` incluye `<float.h>`), y `stdatomic.h` muere en
  `uchar.h:47: error: ';' expected (got 'char16_t')`. El árbol de includes de
  Termux tiene **1.968 basenames duplicados**: hay más minas além de errno.

### La receta (caso verde de la batería)

`T6/cc_pragma_once_colision_de_basename_con_recipe` (PASS): shadow-dir listado
**delante** en `-I` con una copia del header real sin `#pragma once` — y
`errno` queda **funcional** (`errno = EAGAIN; return errno` → `RET=11`, 2/2).
El caso también asserta las tres formas de control: colisión con pragma mata
el hijo, sin pragma compila, y pragma con basename distincto compila.

### Atribución por tasa contra los oficiales

La sonda `probe-upstream-parity` se extendió con tres casos de `cc()` que se
corren en **hijos** (un SIGSEGV no puede cortar el log) y un job nuevo
`probe-aarch64` (`runs-on: ubuntu-24.04-arm`, `bun-linux-aarch64` oficial).
Mismo caso, mismos binarios entre corridas (sha `a83d2637…` x64, `616f267a…`
aarch64):

| Binario | caso único (4 corridas) | tasa 20/20 hijos |
|---|---|---|
| `bun-linux-x64` 1.4.2 oficial | OK, ROJO, OK, OK → **1/4** | **12/20** |
| `bun-linux-aarch64` 1.4.2 oficial | ROJO 3/3 | **13/20** |
| Nuestro ELF android (dispositivo) | crash siempre | **20/20** |

Runs: `37791139445`, `37792716755`, `37793508977`, `37793514722`,
`37794547875`. El `bun-linux-aarch64-android` oficial **no es comparable**:
probado en el teléfono, su `cc()` lanza "TinyCC is disabled" (upstream apaga
tinycc en android; este port, con 0002/0003, es el primero que la corre).
Lectura: bug **latente** de la libtcc vendored, sensible al layout de memoria
— en los oficiales crashea con probabilidad ~⅔ y en nuestro ELF la probabilidad
llega a 1. Los `bun.report` codifican la misma ubicación para x64 y aarch64
(`la1744846f…`/`La1744846f…`); no hay nada de `patches/android/` en el camino.
`float.h`: **ROJO también arriba** en ambas arquitecturas ⇒ no perdimos los
builtin en nuestra cadena, tinycc no lo trae.

### Batería final (el mismo ELF, sin rebuild desde A1)

Dos casos nuevos sobre el sello de A3: `T10/dns_ruta_sistema_vive_y_la_cruda_no`
(sonda: el crudo lanza `queryA ETIMEOUT` a ~21 s, `lookup()` vive) y la receta
T6. Sello `a5-full` (154, PASS=145) y sello final **`a6-full.log`/`a6-full.json`**:

| Tier | casos | PASS | FAIL | KNOWN | vs A3 |
|---|---|---|---|---|---|
| T1 CLI | 18 | 18 | — | — | igual |
| T2 node compat | 27 | 26 | — | 1 | igual |
| T3 http/TLS | 19 | 19 | — | — | igual |
| T4 storage | 14 | 14 | — | — | igual |
| T5 install/build | 13 | 12 | — | 1 | igual |
| T6 FFI/TinyCC | 10 | 9 | — | 1 | **+1 receta verde** |
| T7 `--compile` | 4 | 4 | — | — | igual |
| T8 edges Termux | 17 | 17 | — | — | igual |
| T9 APIs producto | 5 | 3 | — | 2 | igual |
| T10 producto + runner | 28 | 24 | — | 4 | **+1 dns verde** |
| **total** | **155** | **146** | **0** | **9** | **0 FAIL, 0 TIMEOUT, 0 SKIP, 0 UNEXPECTED** |

`PASS=146 FAIL=0 TIMEOUT=0 SKIP=0 KNOWN=9 UNEXPECTED=0`, `BATTERY_DONE rc=0`,
sha256 `31392bdeb78b99591da54a4d468037b5661e8e27bd109f60982e8b368de37e70`,
`--revision` `1.4.2-canary.1+39338cc1c`.

### Decisión y estado tras A4

Ningún rojo nuevo, ningún verde perdido, y el último KNOWN sin causa deja de
estar "abierto": tiene disparador mínimo, tasa contra oficiales y receta
funcional. **Sin parche 0008, 0009 ni 0010.** El port sigue afirmado por
evidencia en 155 casos; `release-android.yml` no se dispatcheó.


## Bitácora

- 2026-10-07: B0 en ejecución; pines verificados (ver manifest); sha256 del
  tarball streammeado: `25e09a8804535b8fbea1dad9f95af8402fc9133d28127d5594ff00df1549590e`.
- 2026-10-07: por instrucción explícita del usuario, el binario validado de
  M3 se instaló además en `~/.local/bin/bun` (shadowea al bun 1.3.14 de
  `$PREFIX/bin`, accesible como `~/.local/bin/bun1.3.14`). Las menciones
  históricas a `~/.local/bin` arriba reflejan la regla vigente al momento de
  cada evidencia.
- 2026-10-08: sonda de paridad dispatcheada dos veces (runs `37776390386` y
  `37780014509`) sobre el `bun-linux-x64` oficial 1.4.2; con eso los 5 `KNOWN`
  de la batería quedan atribuidos (2 upstream 1.4.x, 1 comportamiento
  upstream, 1 entorno Termux, 1 tinycc/bionic).
- 2026-10-08: se midió que `cc()` SÍ linkea libc en Android con
  `-L/apex/com.android.runtime/lib64/bionic -lc` (y `BUN_TCC_OPTIONS` a nivel
  proceso), así que la limitación de FFI pasó a verde sin parche. Descartado
  el patch 0008 de default: sin `-nostdlib` los dispositivos API 28 sin
  namespace APEX se quedan sin `cc()`.
- 2026-10-08 (A3): tier **T10** (27 casos) añadido tras nueve sondas en el
  dispositivo; 153 casos en 10 tiers y `PASS=144 FAIL=0 KNOWN=9 UNEXPECTED=0`
  con `BATTERY_DONE rc=0` sobre el mismo ELF (`a4-full.log`). En el camino se
  corrigió un defecto del harness (`eq` por identidad) que producía rojos
  ilegibles: ahora existe `eqJSON`.
- 2026-10-08 (A3): sonda de paridad run `37787168311` clasificó los 4 stubs
  nuevos (`Archive`, `Image`, `CSRF`, `indexOfLine` con string) como
  **idénticos en el `bun-linux-x64` oficial 1.4.2**, y además refutó la
  hipótesis de que `--coverage` no imprima tabla por ser un build Android: en
  linux-x64 tampoco. Con eso los 9 `KNOWN` quedan con causa medida y no hubo
  parche 0009.
- 2026-10-08 (A4): causa raíz del crash de libtcc acotada por las sondas
  `a5*`: `#pragma once` + colisión de basename (disparador mínimo, 20/20 en
  el dispositivo). Receta medida y fijada como caso verde
  (`T6/cc_pragma_once_colision_de_basename_con_recipe`, `errno` → `RET=11`).
  Gaps hermanos documentados: sin `float.h`/`iso646.h` builtin, `uchar.h` con
  `char16_t`, 1.968 basenames duplicados en `$PREFIX/include`. Sellos `a5-full`
  (154, PASS=145) y `a6-full` (155, PASS=146, KNOWN=9, `BATTERY_DONE rc=0`).
- 2026-10-08 (A4): la sonda upstream se extendió con tres casos `cc()` en
  hijos y el job `probe-aarch64` (oficial `bun-linux-aarch64`, runner arm).
  Tasas del mismo repro: 12/20 (x64 oficial), 13/20 (aarch64 oficial), 20/20
  (nuestro ELF) — bug latente de la libtcc vendored, **no** del port; `float.h`
  tampoco existe arriba. Runs `37791139445`/`37792716755`/`37793508977`/
  `37793514722`/`37794547875`. Sin parche 0010. El `bun-linux-aarch64-android`
  oficial bajado al teléfono confirma que upstream trae TinyCC apagada en
  android (`cc()` throw "not available in this build").
- 2026-10-08 (incidente operativo, sin daño): correr `verify-device.sh` con
  una copia vieja (`$PREFIX/tmp/bunandroid/bun`, 1.2.13 de la era anterior)
  **downgradeó** `~/.bun-android/bin/bun` porque el script instalaba antes de
  validar la versión. Restaurado en el momento desde `~/.local/bin/bun`, sha
  intacto `31392bde…` (byte a byte el del sello `a6-full`). El script quedó
  endurecido: `-ef` (source==dest aborta) y `--version` de SRC chequeda
  **antes** de instalar; ambos guardas probados en vivo.
