# Known issues y limitaciones medidas

Cosas que **no** están perfectas en el port, cada una con su estado y su
evidencia. Nada aquí es teórico: o se midió rojo en el teléfono o se portó
como limitación consciente.

## Runtime / CLI

- **`dns.promises.resolve()` cuelga**: `dns.lookup`/`dns.resolve4` por
  getaddrinfo funcionan, pero el resolver crudo de `node:dns` (`resolve`,
  `resolveAny` con servidor explícito) nunca resuelve ni rechaza: el proceso
  queda vivo para siempre (mediado con `8.8.8.8` y con el router). Idéntico en
  el android oficial 1.3.14 ⇒ limitación de entorno (Termux no tiene
  `/etc/resolv.conf`), **sin parche**. Caso medido: `T2/node_dns_raw_resolve`
  (expect=KNOWN en la batería).
- **Shim `node` de `bun run`**: parcheado con
  [`0007`](../patches/android/0007-android-node-shim-dir-termux.patch)
  (shim en `tmp` de Termux); el `const` es compile-time, así que un prefijo
  no estándar vuelve al comportamiento anterior: sin shim, sin crash.
- **`cc()` de `bun:ffi` sin stdlib**: con el patch 0006 (`-nostdlib`) el
  código C que referencie símbolos libc necesita resolución explícita
  adicional del usuario. Idéntico a la era Zig; fuera del smoke de paridad
  pero es una limitación real de FFI.
- **`bun install` no borra el directorio de una dep podada**: quitar una dep
  de `package.json` y reinstalar actualiza `bun.lock` (la dep desaparece del
  grafo) pero deja `node_modules/<dep>` materializado y todavía resoluble por
  `require`. Idéntico en 1.3.14 ⇒ comportamiento upstream, sin parche. Caso
  medido: `T5/install_removes_pruned_dep` (expect=KNOWN).
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
