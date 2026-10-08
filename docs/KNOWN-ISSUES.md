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
  - **Causa raíz acotada en A4** (sondas `a5*`): libtcc sega cuando un
    archivo cuyo **basename** es `X` lleva `#pragma once` **y** trae debajo
    otro archivo con el mismo basename `X`. Bionic la pica en la ruta real
    (`errno.h` con pragma → `linux/errno.h` → `asm/errno.h` →
    `asm-generic/errno.h`); glibc se salva porque usa include guards. El
    disparador mínimo es sintético (dos archivos `errno.h` nuestros) y aun así
    **20/20** en este ELF.
  - **Atribución por tasa contra oficiales** (sonda `probe-upstream-parity`,
    casos en hijo + job `probe-aarch64`, runs `37792716755`/`37793508977`/
    `37793514722`/`37794547875`): el mismo repro sintético sega **12/20** en
    el `bun-linux-x64` oficial 1.4.2 y **13/20** en el `bun-linux-aarch64`
    oficial ⇒ bug **latente de la libtcc vendored**, sensible al layout de
    memoria; nuestro build android lo lleva a probabilidad ≈1 pero no lo
    introduce (nada de `patches/android/` en el camino; el
    `bun-linux-aarch64-android` oficial ni siquiera trae TinyCC: `cc()` throw
    "not available in this build"). **Sin parche** por la regla del plan.
  - **Receta medida y verde**: shadow-dir en `-I` **delante** con una copia
    del header real sin `#pragma once` — deja `errno` funcional (`EAGAIN` →
    `RET=11`). Caso: `T6/cc_pragma_once_colision_de_basename_con_recipe`
    (PASS); los controles (sin pragma / basename distincto) también viven ahí.
  - **Gaps hermanos del mismo preprocessor**: tcc sirve `stddef.h`/`stdarg.h`
    builtin pero **no** `float.h` ni `iso646.h` (y bionic `limits.h:58`
    incluye `<float.h>`; `float.h` tampoco existe en los oficiales ⇒ no lo
    perdimos nosotros), y `stdatomic.h` muere en `uchar.h:47: error: ';'
    expected (got 'char16_t')`. El árbol `$PREFIX/include` tiene **1.968**
    basenames duplicados: la mina no es solo `errno.h`.
  Casos medidos: `T6/cc_headers_bionic_con_crash` (expect=KNOWN) y
  `T6/cc_headers_bionic_que_tcc_parsea` (verde, fija la cobertura real).
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
- Formas de API que se asumen mal y **no** lo son (todas medidas en A3):
  `Bun.JSONL` no tiene `stringify`, su segunda clave es `parseChunk` y
  devuelve `{values, read, done, error}`. `Bun.deepMatch(a, b)` toma el
  **patrón primero** (`deepMatch({a:1},{a:1,b:2})` es `true`, al revés `false`)
  y los arrays **no** son subconjuntos. `Bun.Glob.scanSync()` es un generador:
  hay que materializarlo con `[...]`. `Bun.mmap` acepta `(path)` y
  `(path, opts)`; `mmap(n, path)` y `mmap(path, offset, len)` lanzan.
  `Bun.sliceAnsi` re-cierra el color con `\x1b[39m`, y `Bun.wrapAnsi("abc",
  código)` no agrega nada visible al string. `Bun.sha("hola")` da 32 bytes
  deterministas pero **no** es SHA-256 (empieza `49 11 de…` contra
  `b2 21 d9…` de `CryptoHasher("sha256")`).
- Los **import attributes** cachean por *specifier*, no por attribute:
  importar el mismo URL con `{type:"file"}` y después con `{type:"text"}`
  devuelve el primer módulo resuelto (y un `#fragmento` no fuerza re-resolver).
  Además `with {type:"file"}` devuelve la **ruta absoluta**, no el contenido,
  en todas las formas de specifier (relativo, `file://`, con `?query`).
- `bun:test` exporta `spyOn`, **no** `spy`: importar `spy` es `SyntaxError` y
  se lee como un `rc=1` de cobertura.
- `node:vm` es cross-realm: `runInNewContext("[b, typeof a]", {b:5})` devuelve
  un array del realm del script, que no es `===` a un literal del fixture (y
  `instanceof Array` tampoco). Comparar por contenido.

## Stubs de producto medidos en A3 (no son del port: fallan igual arriba)

Cuatro APIs existen en el namespace pero no hacen nada útil. Cada una fue
medida en el ELF android **y** en el `bun-linux-x64` 1.4.2 oficial (job
`probe-upstream-parity`, run `37787168311`), y tres también en el oráculo
Android 1.3.14. La regla del plan aplica tal cual: reproduce arriba ⇒ se
documenta, no se parchea.

| API | qué hace realmente (medido) | upstream linux-x64 |
|---|---|---|
| `Bun.Archive.write(path, {files})` | crea un archivo de 10.240 B cuya magic es `"fi"`, **no** `"PK"`; `new Bun.Archive({file}).files` lista **0** entradas | rojo igual (`magic=fi size=10240`) |
| `Bun.Image` | `.width`/`.height` = `-1`×`-1` sobre un PNG 1×1 válido; los métodos de encode no devuelven nada; `Bun.Image.backend` es el string `"bun"` y no existe `Bun.Image.from` | rojo igual (`dims=-1x-1`) |
| `Bun.CSRF` | `generate(secret)` devuelve 86 chars pero `verify(secret, token)` con **el mismo secret** devuelve `false`; solo estáticos (`new Bun.CSRF(…)` → "Object is not a constructor"; objeto como argumento → "Secret must be a non-empty string") | rojo igual |
| `Bun.indexOfLine(string, pos)` | `-1` con string; con `Buffer` sí funciona (`4` en `"a\nbb\nccc"`). La semántica es "índice del `\n` que cierra la línea que contiene `pos`" | rojo igual (`string=-1`) |

Nada de esto toca `patches/android/`: ni la lectura de los buffers ni el
layout del archivo dependen de bionic. Cualquier fix sería mantención de
código de producto ajena al port.

Dos más, del runner y de una dependencia:

- **`bun test --coverage` sale 0 pero no imprime tabla de porcentajes.** La
  hipótesis "será del build Android" se **refutó**: en linux-x64 oficial
  tampoco imprime nada (mismo run). Idéntico en el oráculo 1.3.14.
- **`bun:sqlite` no tiene `function`/`backup`/`deserialize`** en el prototype
  (sólo `clearQueryCache, close, exec, fileControl, handle, inTransaction,
  loadExtension, prepare, query, run, serialize, transaction`) y
  `db.loadExtension(path)` lanza `undefined symbol: sqlite3_sqlite3_init`.
  El mismo symbol error aparece en linux-x64 apuntando a su
  `libsqlite3.so`, o sea que viene del amálgama de SQLite que embebe
  upstream, no de nuestro linker.

## Entorno Termux (medido, sin parche necesario)

- `epoll_pwait2`, `fchmodat2`, `close_range`: sin SIGSYS en este kernel
  (5.10); los fallbacks existentes (usockets `bun_epoll_pwait2`, bun-spawn)
  alcanzan.
- `RLIMIT_NOFILE` 32768/32768: el bump a 163840 de la era Zig era para la
  suite de tests de upstream, no para paridad. Se reconsidera con workload
  real.
- Heap tagging: no necesario — el JSC es el prebuilt oficial de upstream y
  el estrés en dispositivo no mostró crashes.
- **El resolver crudo no tiene a quién preguntar.** `Bun.dns.getServers()`
  devuelve `["127.0.0.1"]`: Android publica dnsproxyd en loopback y ese
  puerto **no responde** desde el uid de Termux (medido: un `sendto` UDP a
  `127.0.0.1:53` no recibe nunca, no es `ECONNREFUSED`). Caen por el mismo
  motivo todos los caminos crudos — `node:dns.promises.resolve4()` cuelga y
  `Bun.dns.resolve(..., {verb:true})` lanza `queryA ETIMEOUT` **tras ~21 s**
  (medido 20792 ms; si un fixture le pone una carrera de 20 s afirma el error
  del wrapper, no el de bun) — mientras la ruta de sistema funciona
  (`node:dns.promises.lookup()` da `104.20.23.154`).
  No hay `/etc/resolv.conf` ni `net.dns*` que setear. Nota para leer logs: el
  proceso sí muere limpio tras el `ETIMEOUT` (`rc=0`); si un probe con
  `dgram` queda vivo es el socket propio sin cerrar, no el port.
- Sockets unix: funcionan sobre bionic (`Bun.serve({unix})`, `fetch(...,
  {unix})`, `Bun.listen({unix, socket})` servido a un cliente `node:net`), así
  que nada que dependa de AF_UNIX necesita workaround.

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
