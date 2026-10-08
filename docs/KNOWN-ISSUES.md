# Known issues y limitaciones medidas

Cosas que **no** están perfectas en el port, cada una con su estado y su
evidencia. Nada aquí es teórico: o se midió rojo en el teléfono o se portó
como limitación consciente.

## Runtime / CLI

- **`dns.promises.resolve()` cuelga**: `dns.lookup`/`dns.resolve4` por
  getaddrinfo funcionan, pero el resolver crudo de `node:dns` (`resolve`,
  `resolveAny` con servidor explícito) nunca resuelve ni rechaza: el proceso
  queda vivo para siempre (mediado con `8.8.8.8` y con el router). Idéntico en
  el android oficial 1.3.14 y, a la inversa, **verde en el linux-x64 oficial
  1.4.2** (run `37780014509`: `dns_raw_resolve|OK|["104.20.23.154", …]`) ⇒ el
  código está bien, es el entorno: Termux no tiene `/etc/resolv.conf` ni
  `/system/etc/resolv.conf`, y las props `net.dns1`/`net.dns2`/`dns.server`
  están vacías (Android saca los resolvers por el canal privado de
  `dnsproxyd`, que no es alcanzable desde un binario de app sin root).
  **Sin parche**: inventar un resolver hardcodeado sería peor que el fallo.
  Caso medido: `T2/node_dns_raw_resolve` (expect=KNOWN en la batería).
- **Shim `node` de `bun run`**: parcheado con
  [`0007`](../patches/android/0007-android-node-shim-dir-termux.patch)
  (shim en `tmp` de Termux); el `const` es compile-time, así que un prefijo
  no estándar vuelve al comportamiento anterior: sin shim, sin crash.
- **Ciertos headers bionic matan libtcc (SIGSEGV en compile)**: con la receta
  de includes de Termux, `#include <errno.h>`, `<unistd.h>`, `<stdlib.h>`,
  `<time.h>`, `<fcntl.h>` y `<sys/stat.h>` tiran el proceso con
  `panic(main thread): Segmentation fault` **en la etapa de compilación** (el
  hijo muere 139 antes de devolver). Bisección por hoja medida en A2: los
  `linux/*.h` y los `bits/*.h` individuais compilan solos, y `bits/wait.h`
  pica por su cuenta, así que el crash lo produce la composición del header
  de bionic, no un token aislado. Mitigaciones por `-D` probadas y **sin**
  efecto: `-D_FORTIFY_SOURCE=0`, `-D_Nullable= -D_Nonnull=`. Los headers que
  sí parsean hoy: `<string.h>`, `<stdio.h>`, `<dlfcn.h>`, `<stddef.h>`
  (builtin de tcc), `<stdint.h>`, `<malloc.h>`, `<alloca.h>`, `<xlocale.h>`.
  Causa de fondo: oven-sh/tinycc no tiene soporte bionic — es exactamente el
  motivo por el que upstream apagaba TinyCC en Android antes del patch 0002,
  y re-habilitarlo fue decisión del port. **Sin parche posible en este loop**
  (sería trabajo dentro del C preprocessor de la dependencia vendored, con un
  ciclo de CI por hipótesis). Casos medidos: `T6/cc_headers_bionic_con_crash`
  (expect=KNOWN) y `T6/cc_headers_bionic_que_tcc_parsea` (verde, fija la
  cobertura real).
- **`bun install` no borra el directorio de una dep podada**: quitar una dep
  de `package.json` y reinstalar actualiza `bun.lock` (la dep desaparece del
  grafo) pero deja `node_modules/<dep>` materializado y todavía resoluble por
  `require`. Reproducido igual en el bun 1.4.2 oficial linux-x64 (run
  `37780014509`: `node_modules/is-odd sigue materializada…`) y en el oráculo
  1.3.14 ⇒ comportamiento upstream, sin parche. Detalle medido: con **cero**
  deps el lockfile vacío sí se borra. Caso medido:
  `T5/install_removes_pruned_dep` (expect=KNOWN).
- **Standalone inflado**: `bun build --compile` embebe el runtime ci-build
  con DWARF (~+190 MB). Ver [`STANDALONE.md`](STANDALONE.md).
- **`EventSource` no existe en 1.4.x**: `typeof EventSource === "undefined"`
  en nuestro ELF **y** en el bun 1.4.2 oficial linux-x64 pineado (revision
  `1.4.2+744846f84`, sha `a83d263767d8…`, job `probe-upstream-parity` run
  `37776390386`); tampoco estaba en el oráculo android 1.3.14. No es un gap
  del port sino de la línea 1.4.x ⇒ **sin parche**, y el streaming SSE se
  verifica por la otra mitad del protocolo (`fetch` + `ReadableStream`, caso
  `T3/fetch_lee_un_sse_stream`, verde). Caso medido:
  `T9/eventsource_global_available` (expect=KNOWN).
- **Handlers globales de `node:worker_threads` ignorados**: un worker que
  hace `onmessage = (e) => postMessage(...)` sin importar `parentPort` queda
  **silencioso para siempre** (hang, no error). Mismo hang en el linux-x64
  oficial 1.4.2 (run `37776390386`); Node 26/22 lanzan `ReferenceError`, y en
  bun 1.3.x estos handlers sí despachaban. La ruta portable es importar
  `parentPort` (caso verde `T2/worker_sharedarraybuffer_atomics`).
  Consecuencia práctica para la batería: los hangs se miden con timeout
  interno acotado, no con el timeout del runner. Caso medido:
  `T9/worker_bare_onmessage_global` (expect=KNOWN).

## Semántica medida que sorprende (no son bugs, pero hay que saberlos)

- `Bun.gzipSync`/`deflateSync` devuelven `Uint8Array`, y su `.toString()` es
  la lista de bytes separada por coma: se decodifica con `TextDecoder`.
  Byte-idéntico al oráculo 1.3.14 (mismo `len=120` para el mismo payload).
- `Bun.password.verifySync(user, hash)` con un hash **malformado lanza**
  `UnsupportedAlgorithm` en vez de devolver `false`; con la clave incorrecta
  y hash válido devuelve `false`. Igual en 1.3.14.
- `Bun.Transpiler`: la opción que elige el parser es `loader`, no `lang`
  (con `lang: "ts"` el input se parsea como jsx y falla). `transform()` es
  async; `transformSync()` también existe. `scanImports` devuelve
  `[{kind:"import-statement", path:"./m1"}, …]`.
- `cc()` de `bun:ffi` **sí** puede linkear libc en Android; el default del port
  (`-nostdlib`, patch 0006) no lo hace, a propósito. Dos recetas medidas en
  dispositivo (los dos casos verdes en T6):
  ```js
  // por llamada: `flags` REEMPLAZA los defaults (ffi_body.rs:616), no los
  // agrega; por eso NO hay que repetir -nostdlib.
  cc({ source, symbols, flags: "-L/apex/com.android.runtime/lib64/bionic -lc" });
  ```
  ```sh
  # o para todo el proceso: escape hatch de upstream (ffi_body.rs:619)
  BUN_TCC_OPTIONS="-std=c11 -L/apex/com.android.runtime/lib64/bionic -lc" bun app.mjs
  ```
  La libc real de bionic está en `/apex/com.android.runtime/lib64/bionic/libc.so`
  (1.156.440 B); `/system/lib64/libc.so` es un stub de 46 B y **no** sirve para
  linkear. Buscarla sin `-L` da `library 'c' not found`, y meter `-lc` con
  `-nostdlib` activo queda sin resolver (medido). Con la receta, `getpid()`
  desde C compilado en runtime coincide con `process.pid`. Para los headers de
  Termux hace falta además `-I$PREFIX/include` y
  `-D__ANDROID_MIN_SDK_VERSION__=28` (si no, `sys/cdefs.h:365` aborta con
  `#error Unversioned target triples are not supported!`).
- `BroadcastChannel` es un `EventTarget` (no tiene `.once`), y un canal
  main↔worker pierde el primer mensaje si el listener del worker aún no está
  registrado: hay que sincronizar (el worker avisa por `parentPort` y recién
  ahí se postea).

## Entorno Termux (medido, sin parche necesario)

- `epoll_pwait2`, `fchmodat2`, `close_range`: sin SIGSYS en este kernel
  (5.10); los fallbacks existentes (usockets `bun_epoll_pwait2`, bun-spawn)
  alcanzan.
- `RLIMIT_NOFILE` 32768/32768: el bump a 163840 de la era Zig era para la
  suite de tests de upstream, no para paridad. Se reconsidera con workload
  real.
- Heap tagging: no necesario — el JSC es el prebuilt oficial de upstream y
  el estrés en dispositivo no mostró crashes.

## Build / CI

- **Cache keys vs pins**: cambiar `ci/source-manifest.json` invalida las
  keys `ci-cache-v1-toolchain-*`/`ci-cache-v1-jsc-*` ⇒ la corrida siguiente
  vuelve a bajar NDK/LLVM/JSC (~20 min extra). Es el diseño correcto
  (staleness defense), no un bug.
- **Logs de Actions truncados**: los job logs pueden perder líneas (gaps de
  numeración `[i/N]`). Regla de diagnóstico: verificar continuidad de
  numeración antes de concluir "edges faltantes" (falsa alarma vivida con
  tinycc).
- **cmake**: usar SIEMPRE la distro `.tar.gz`; el self-extractor `.sh` de
  Kitware muere en el runner (M0, run `37624652911`).

## Parcheabilidad (reglas que evitan parches incorrectos)

- Los parches se generan desde árboles mínimos en `$PREFIX/tmp` con baseline
  upstream commit **antes** de editar (ver PATCHES.md "Cómo agregar").
  Un baseline ya editado produce un `format-patch` invertido (error vivido
  con `m3-tccext`).
- Todo "repro" de terceros (o de un subagente) se **vuelve a medir acá** antes
  de tocar un parche: en la auditoría A1 dos reportes (SIGSEGV en `bun x`,
  techo de 176 fds con `RLIMIT_NOFILE` 32768) no reprodujeron — 8/8 corridas
  de `bun x` dieron rc=0 y 50 spawns concurrentes pasaron. Ninguno de los dos
  traía el cambio de harness que afirmaban aplicar.
- `verify-*.sh` usan env variables *inline* en `bash -c` para tmux/fish:
  las variables deben ir embebidas como rutas literales (sin exportar `$SM`,
  o la captura sale vacía).
- `gh run cancel` no tiene `--yes`; propagación del cancel tarda un poll
  (la concurrency group mantiene el nuevo run pendiente hasta que el viejo
  muere).

## Publicación

- El dispatch de `release-android.yml` crea una release **pública**: está
  mechanizado y probado en negativo, pero el primer lanzamiento real requiere
  autorización explícita del usuario (modo "seguir y reportar, sin
  publicar").
