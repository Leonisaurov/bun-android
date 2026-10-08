# Known issues y limitaciones medidas

Cosas que **no** están perfectas en el port, cada una con su estado y su
evidencia. Nada aquí es teórico: o se midió rojo en el teléfono o se portó
como limitación consciente.

## Runtime / CLI

- **`dns.promises.resolve()` cuelga** — ~~KNOWN~~ **parcheado con
  [`0008`](../patches/android/0008-android-dns-resolv-conf-termux.patch)**. La
  ruta cruda de `node:dns` (`resolve`, `resolveTxt`, `resolveMx`,
  `Bun.dns.resolve`) quedaba viva para siempre porque el canal c-ares nacía con
  el fallback `127.0.0.1`: Android saca los resolvers por el canal privado de
  `dnsproxyd`, no alcanzable desde un binario de app sin root, y **upstream elige
  dejar ese default** (`Channel::init` en `src/cares_sys/c_ares.rs:722`, con el
  comentario que dice que así `dns.setServers()` funciona como workaround). Lo
  que se había medido mal: Termux **sí** publica `$PREFIX/etc/resolv.conf`
  (`8.8.8.8`/`8.8.4.4`) y esos servidores responden UDP:53 desde el uid de
  Termux (26–42 ms). Con 0008 el canal los siembra; `Bun.dns.getServers()` →
  `["8.8.8.8","8.8.4.4"]` y `resolve()` de A tarda 20–45 ms.
  Casos medidos: `T2/node_dns_raw_resolve` (expect=PASS desde el sello
  `a8-full`), `T10/dns_getservers_siembra_el_resolv_conf_de_termux` y
  `T10/dns_ruta_sistema_y_cruda_ambas_vivas`.
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
  - **Segunda receta verde (A5), sin tocar el preprocessor**: preprocesar con
    `clang -E -std=gnu11` y entregarle a `cc()` el plano sin cadena de
    `#include`. Filtros necesarios, medidos contra el error real: directivas de
    línea, `_Nullable`/`_Nonnull`/`_Null_unspecified`, `__extension__`, las
    líneas con `__int128`, las con `__overloadable__`, y `#define ioctl
    __tcc_no_ioctl`. El filtro de `__int128` borra **solo** los dos typedefs de
    bionic; el plano redeclara `__s128`/`__u128` con el placeholder propio de
    tinycc (`include/tccdefs.h:182-186`, 16 bytes / align 16), así que ningún
    tipo desaparece y el caso lo fija (`sizeof*100+__alignof__ = 1616`). Los
    flags tienen que llegar al hijo (`flags: process.argv[3]`, `-L… -lc`): sin
    linkage, tcc compila el plano pero deja `__errno`/`time`/`open`/`close`/
    `stat` sin resolver. Caso: `T6/cc_headers_bionic_via_clang_preprocesado`
    (PASS, cadena `errno+unistd+stdlib+string+time+fcntl+sys/stat`, `RET=7`).
    Limitación honesta: la **aritmética** de 128 bits no funciona (error duro
    de compilación, nunca silencioso) y `-E` requiere clang instalado.
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

- **`Bun.dns.resolve(hostname, {recordType:"TXT"})` ignora el campo y hace
  `queryA`** (`queryA ENOTFOUND _dmarc.github.com`), mientras la forma
  **posicional** `Bun.dns.resolve("_dmarc.github.com", "TXT")` sí devuelve el
  registro. Con `{recordType:"MX"}` sobre `google.com` devuelve objetos
  `{address, ttl}` (o sea, sigue siendo A). Reprodujo **idéntico** en los
  oficiales linux-x64 y linux-aarch64
  1.4.2 (shas `a83d2637…`/`616f267a…`, run `37845989483`, caso
  `recordtype_obj_ignored`) ⇒ wrapper de producto, **sin parche**. Para un
  fixture: usar `node:dns.promises.resolveTxt/resolveMx`, que sí respetan el
  tipo. Caso medido: `T10/dns_resolve_obj_recordtype_elige_el_tipo`
  (expect=KNOWN).
- **`Bun.dns.setServers` exige triples `[family, address, port]`**, no
  direcciones sueltas: con `["8.8.8.8"]` lanza `ERR_INVALID_ARG_TYPE` ("Expected
  triple to be a array"). El shape está leído del JS embebido en el propio ELF
  (`triples.push([ipVersion, …])`) y la ruta que lo consume es
  `set_channel_servers` (lee índice 0 = familia, 1 = address, 2 = puerto).
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
- **El dnsproxyd de Android no es alcanzable (y no hace falta).** Android
  publica sus resolvers por un canal privado en loopback y ese puerto
  **no responde** desde el uid de Termux (medido: un `sendto` UDP a
  `127.0.0.1:53` no recibe nunca, no es `ECONNREFUSED`); no hay
  `/etc/resolv.conf` en ruta FHS ni props `net.dns*` que setear
  (`getprop net.dns1` sale vacío). Era la causa de los timeouts de ~21 s que
  se veían antes de **0008**; hoy el port siembra los nameservers de
  `$PREFIX/etc/resolv.conf`, que sí responden (ver el primer bullet de
  Runtime/CLI). Dos notas de lectura de logs que siguen valiendo: si un
  fixture le pone una carrera de 20 s a `Bun.dns.resolve` afirma el error del
  wrapper, no el de bun; y el proceso muere limpio (`rc=0`) tras un
  `ETIMEOUT` — si un probe con `dgram` queda vivo es el socket propio sin
  cerrar, no el port.
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
