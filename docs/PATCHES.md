# Parches Android/Termux

Adaptaciones de fuente sobre el commit pineado de `oven-sh/bun`
(`bun-v1.4.2`). Viven en [`patches/android/`](../patches/android/), se aplican
en orden alfabético con `git am --3way` dentro de
[`ci/validate-source-tree.sh`](../ci/validate-source-tree.sh), y CI falla si
el árbol queda sucio después de aplicarlos. **Nunca** mutaciones sucias sobre
el checkout.

Regla de cierre: cada parche se justifica con una **medición en el teléfono**
(rojo antes, verde después), no con "upstream lo trae así". La evidencia está
en [`PROGRESS.md`](PROGRESS.md).

## 0001 · openat2 SIGSYS → ENOSYS + fallback

`src/sys/linux_syscall.rs` + `src/runtime/server/DirectoryRoute.rs`. Bajo el
seccomp de Termux, `openat2` (usado por `openat2_in_root` al servir una
ruta-directorio de `Bun.serve`) no devuelve ENOSYS: **mata con SIGSYS**
(rc=159, medido). El parche hace que en android el syscall short-circuite a
ENOSYS y `DirectoryRoute` caiga al `openat` clásico. Verde en dispositivo:
run `37638826721`, `scripts/verify-sigsys-device.sh`.

## El gate cuádruple de TinyCC

Upstream desactiva TinyCC (compilador C embebido para `bun:ffi` `cc()`) en
android. Reactivarlo costó cuatro capas independientes; cada una se descubrió
solo al pasar la anterior, y cada fallo tenía un síntoma distinto:

| # | Capa | Síntoma sin el parche |
|---|---|---|
| 0002 | build: `config.ts` gate `tinycc = … && abi != android` + defines de `deps/tinycc.ts` | libtcc ni siquiera se compila en el grafo |
| 0003 | codegen: `buildOptionsRs.ts` genera `ENABLE_TINYCC = !cfg!(android…)` → guard runtime en `ffi_body.rs` | `cc()` lanza "TinyCC is not available in this build" |
| 0005 | enlace: el macro `tcc_externs!` de `src/tcc_sys/tcc.rs` define los `extern "C"` como `unreachable!()` en android (upstream no construye libtcc ahí) | panic rc=134 en `tcc_new` (build `36214c433`) |
| 0006 | runtime: `tcc_add_runtime` de libtcc añade `-lc` salvo `nostdlib`, y busca dirs FHS (`/usr/lib`, …) que en Termux no existen | `tcc: error: library 'c' not found` al compilar el primer snippet |

### 0002 · reactivación del build DirectBuild

`scripts/build/config.ts` + `scripts/build/deps/tinycc.ts`: habilita el
compile cruzado de libtcc (fetch del crate pineado `oven-sh/tinycc@05f0fafaa3be`,
codegen de `tccdefs_.h`, ~10 objetos linkeados directo a la línea de bun —
`archiveDeps=false`). Añade defines bionic: `CONFIG_TCC_CROSSPREFIX=""` y
`CONFIG_TCCDIR=/data/data/com.termux/files/usr/lib/tcc`. Nota de diagnóstico:
la aparente "falta de edges" en el log de Actions era **truncado del log**
(gaps de numeración `[i/1224]`), no edges ausentes.

### 0003 · ENABLE_TINYCC en codegen Rust

`scripts/build/buildOptionsRs.ts`: se retira la línea `target_os = "android"`
del predicado que genera el `pub const ENABLE_TINYCC`. Es el guard que lee
`cc()` en `src/runtime/ffi/ffi_body.rs`.

### 0004 · tmpdir Termux en `node:os`

`src/js/node/os.ts`: con `TMPDIR` ausente, `os.tmpdir()` caía a
`/data/local/tmp`, no escribible por el uid de Termux ⇒ `mkdtemp` EACCES
(rojo medido). Fallback a `/data/data/com.termux/files/usr/tmp` (análogo del
fix `platformTempDir` zig-era). Verde: run `37646043259`,
`scripts/verify-tmpdir-device.sh`. No parcheado a propósito: el const
`BUN_NODE_DIR` de `src/install/lib.rs` (shim `node` de `bun run`) sigue en
`/data/local/tmp` — periférico, fuera del alcance de los smokes.

### 0005 · externs reales de libtcc

`src/tcc_sys/tcc.rs`: los predicados del macro `tcc_externs!` quedan
freebsd-only; android enlaza contra los objetos reales de libtcc que produce
0002. Con 0003 pero sin 0005, `tcc_new` caía en el stub `unreachable!()`.

### 0006 · defaults `-nostdlib` para bionic

`src/runtime/ffi/ffi_body.rs`: los dos sitios de `CompileC`
(`DEFAULT_TCC_OPTIONS` y el fallback de `compile()`) añaden `-nostdlib` en
android, alineándose con los defaults zig-era (`ffi.zig:1501` ya pasaba
`-std=c11 -nostdlib -Wl,--export-all-symbols`) y con el camino napi de 1.4.2
(`Function::compile` ya usaba `-nostdlib` internamente).
**Limitación portada** (idéntica a la era Zig): sin stdlib, código C que
referencie símbolos libc requiere resolución adicional del usuario; fuera del
smoke de paridad.

## Cómo agregar un parche nuevo

1. Árbol mínimo en `$PREFIX/tmp/<scratch>`: bajar el archivo alterado crudo
   desde `raw.githubusercontent.com` al **commit pineado exacto**, `git
   init`, commit de baseline **antes** de editar (commit con el archivo ya
   editado produce un `format-patch` invertido).
2. Editar, commit, `git format-patch -1 -o $PREFIX/tmp/m3-out`.
3. Copiar a `patches/android/000N-<slug>.patch`, commit aquí, push; CI lo
   aplica en el próximo run y `validate-source-tree.sh` grita si no calza.
