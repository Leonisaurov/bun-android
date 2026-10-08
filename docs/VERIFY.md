# Verificación en dispositivo

Regla de aceptación del proyecto: un hito se cierra con **evidencia corriendo
en el teléfono**, nunca con "compila". Este documento describe el protocolo y
los verificadores. La bitácora de corridas concretas (runs, sha256, fechas)
está en [`PROGRESS.md`](PROGRESS.md).

## Instalación (siempre primero)

```sh
bash scripts/verify-device.sh <path-al-ELF-del-artifact> 1.4.2
```

Instala en `~/.bun-android/bin/bun` y valida `rc=0` + versión exacta; imprime
el sha256 instalado (ese sha es el que se cita en la evidencia). La copia de
uso diario en `~/.local/bin/bun` **no** la escribe el script: se coloca a mano
(`cp` y re-verificar el mismo sha256) por instrucción explícita del usuario del
2026-10-07 — el port era-Zig de `opencode-termux` está cerrado y el oráculo
`bun 1.3.14` queda intacto en `$PREFIX/bin/bun`. En la batería y los
verificadores manda siempre la ruta explícita, nunca el PATH.

El ELF llega del run `android` de
[`build-android.yml`](../.github/workflows/build-android.yml): artifact
`bun-aarch64-android` (`gh run download <run> -n bun-aarch64-android`).

## Verificadores dirigidos (smokes)

Con el binario instalado en `~/.bun-android/bin`, correr en orden:

| Script | Qué prueba | Rojo histórico |
|---|---|---|
| [`verify-sigsys-device.sh`](../scripts/verify-sigsys-device.sh) | `Bun.serve` en ruta-directorio (200), spawn, chmod | rc=159 SIGSYS por `openat2` (parcheado con 0001) |
| [`verify-tmpdir-device.sh`](../scripts/verify-tmpdir-device.sh) | `os.tmpdir()` con `TMPDIR`/`TMP`/`TEMP` ausentes + `mkdtemp` | EACCES en `/data/local/tmp` (parcheado con 0004) |
| [`verify-tinycc-device.sh`](../scripts/verify-tinycc-device.sh) | `bun:ffi` `cc()`: compila C en runtime y llama el símbolo | cadena de cuatro gates (0002/0003/0005/0006) hasta `add3(1,2,3)=6` |
| M2 (manual, tmux) | `bun run` con `fetch()` + `bun:sqlite` SELECT; `bun install` de un paquete pequeño | — |

Smoke M2 equivalente, en tmux (no bloquear la sesión; capturar el pane):

```sh
BUN=$HOME/.bun-android/bin/bun
$BUN -e 'const r = await fetch("https://example.com"); console.log("fetch", r.status);
         const {Database} = require("bun:sqlite");
         const db = new Database(":memory:");
         console.log("sqlite", db.query("select 42 as x").get().x)'
mkdir -p "$PREFIX/tmp/i" && cd "$PREFIX/tmp/i" && $BUN add ms && $BUN -e 'console.log(require("ms")(1000))'
```

`bun add` pequeño verde + `ms(1000) === "1s"` = instalador funcional; el
objetivo completo de paridad son los smokes medidos, no una declaración de
"paridad total" (bundler y installs grandes quedan fuera de lo afirmado; FFI
ya no: tiene su oleada T6).

## Batería amplia T1–T10

Los cuatro verificadores de arriba son **dirigidos**: cada uno cubre un
parche. La batería mide la superficie en bulk (157 casos, 10 tiers) y fue la
herramienta de las auditorías A1 (T1–T8), A2 (extensión + T9), A3 (T10,
superficie de producto y del runner), A4 (causa raíz del crash de libtcc +
receta verde) y A5 (parche 0008 de DNS + segunda receta de headers) de
`PROGRESS.md`. Sello vigente: `a8-full` — 157 casos, `PASS=148 FAIL=0
TIMEOUT=0 SKIP=0 KNOWN=9 UNEXPECTED=0` sobre el sha `3c61913c…`
(revisión `1.4.2-canary.1+0c087fdb9`).

```sh
# en tmux, sin bloquear la sesión; capturar el pane. El `echo rc=$?` va DENTRO
# del sh -c: afuera mediría el rc del wrapper, no el del runner (error vivido).
sh -c './scripts/battery-device.sh --json "$PREFIX/tmp/battery-logs/run.json" \
       > "$PREFIX/tmp/battery-logs/run.log" 2>&1; \
       echo "BATTERY_DONE rc=$?" >> "$PREFIX/tmp/battery-logs/run.log"'
```

Flags (`--list` imprime el manifiesto sin ejecutar):

| Flag | Efecto |
|---|---|
| `--bun PATH` | binario a testear; por defecto `~/.bun-android/bin/bun` (ruta explícita, nunca PATH) |
| `--tiers T1,T4` | subconjunto de oleadas; sin flag, T1→T10 |
| `--case ID` | un solo caso (debug de fixture) |
| `--json OUT` | `summary.json` con `{bun_sha, bun_revision, tier, case, rc, dur, verdict}` por caso |
| `--min-free-mb N` | gate de disco: aborta **antes** de crear scratch si hay menos espacio |
| `--keep` | no borra el scratch (`$PREFIX/tmp/battery-<sha8>-<pid>`, que tiene `trap` de limpieza) |

Tiers: T1 CLI/exit codes/señales · T2 compat `node:*` (fs, os, worker_threads,
child_process, http, dns, net, dgram, tls, zlib, readline) · T3 http y red
reales sobre TCP y TLS locales · T4 storage (`bun:sqlite` archivo+WAL,
`Bun.file`, Blob/FormData, `Bun.hash`, compresión nativa de Bun) · T5
instalador, `bun test`, `bun build`/`bunx` · T6 FFI/TinyCC · T7 `--compile` ·
T8 edges Termux (seccomp por syscall, RLIMIT, paths UTF-8/espacios,
case-sensitivity, heap, fd leaks, TZ/IANA, señales a hijos) · T9 APIs de
producto (`Bun.Transpiler`, `Bun.password`) y los gaps propios de 1.4.x · T10
superficie de producto y del runner (`Bun.TOML/YAML/JSON5/JSONL/XML/semver/
deepMatch/ANSI/mmap/Glob/zstd/peek/dns`, sockets unix con `Bun.serve` y
`Bun.listen`, `bun --watch`, `node:vm`, import attributes, `await using`,
`bun test --coverage`, WebCrypto/Intl).
Manifiesto: [`tests/fixtures/cases.txt`](../tests/fixtures/cases.txt)
(`TIER|archivo|nombre|timeout_s|expect` — segundos, no ms); cada caso es un
`.mjs` que exita 0/1 y se autolimpia, con helpers en
[`tests/fixtures/lib.mjs`](../tests/fixtures/lib.mjs).

Reglas de honestidad del runner (todas nacieron de un falso negativo o falso
positivo vivido):

- **Un proceso `bun` aislado por caso**, cwd = scratch del caso, con
  `timeout -k`. El `rc` se lee del proceso de bun **directamente**, nunca de
  un pipe: `${PIPESTATUS[0]}` no existe bajo el wrapper `sh -c` de Termux y
  medir el rc de `tail` dio una corrida "toda verde" que no era real.
- Veredictos: `PASS | FAIL | TIMEOUT | SKIP | KNOWN | KNOWN-PASS`. `SKIP` es
  la primera línea `#SKIP` del fixture (prerequisito ausente), no un rc.
  `expect=KNOWN` = limitación portada y medida en `KNOWN-ISSUES.md`.
- **UNEXPECTED** es un rojo al revés: un `KNOWN` que pasó. Cuenta como noticia
  y el runner sale 1, igual que con un `FAIL`. Salida: `exit 1` si hay
  cualquier FAIL o UNEXPECTED; `battery_rc=0` en la logfile es el sello del
  cierre.
- Ejecutables compilados (`--compile`, bins de `node_modules/.bin`) se corren
  con el helper `runBin`, no con `self([...])`: pasar un ELF por el runner de
  JS da `Unexpected \x7f` y se lee como rojo del binario.
- Un caso que depende de un shim PATH debe correr con un PATH **privado y
  vacío**; con `$PREFIX/bin` dentro, el `node` real de Termux enmascara el gap
  y el caso sale verde mintiendo.
- Un caso que **puede matar al proceso** (crash nativo, péndulo sin timeout)
  se corre en un HIJO con `Bun.spawn`/`self`, y se afirma sobre el rc del
  hijo. Medido en A2: `#include <errno.h>` en libtcc es SIGSEGV puro; si se
  afirmara en el mismo proceso, la oleada entera se corta y el rojo se lee
  como del runner.
- `eq()` es de **identidad**: dos arrays/objetos con el mismo contenido fallan
  y el mensaje sale como `got X want X` (idénticos), que cuesta media hora de
  triage si no se conoce. Para contenido se usa `eqJSON()` (compara
  `JSON.stringify`). Medido en A3: tres casos de T10 nacieron rojos por esto,
  no por el binario.
- Los valores que salen de otro realm (`node:vm`) o de un generador
  (`Bun.Glob.scanSync`) no son lo que parecen: el array de `vm` es de otro
  realm, y `scanSync` hay que materializarlo con `[...]`. Un assertion que
  asuma `Array.isArray` sobre el resultado de `scanSync` es falso rojo.
- Un `import()` dinámico resuelve el specifier **contra el módulo fixture**, no
  contra el scratch del caso (`BATTERY_CASE_DIR`). Para un archivo escrito por
  el caso se importa por `pathToFileURL(abs).href`; con `"./archivo.txt"` el
  resolver mira `tests/fixtures/` y da `Cannot find module`.
- Lo que cambia el entorno del proceso (`BUN_TCC_OPTIONS`, `TZ`, PATH) también
  se mide en hijo: la batería comparte env y un set in-process contaminaría a
  los casos siguientes.

**Qué no promete la batería**: no es la suite de tests de upstream (esa exige
`RLIMIT`/fixtures propios y queda fuera); no mide rendimiento; no cubre NAPI
nativo ni la plugin API del bundler más allá de `bun build` simple; no prueba
installs grandes ni registry proxies; y no toca el puente M4 standalone (los
casos T7 se autolimitan por disco y borran su ELF de ~291 MB en el mismo paso).

## Sonda de paridad contra upstream (`probe-upstream-parity`)

Un `KNOWN` sólo es honesto si se sabe **de quién es**. El workflow
dispatch-only [`.github/workflows/probe-upstream-parity.yml`](../.github/workflows/probe-upstream-parity.yml)
baja el `bun-linux-x64` **oficial** del tag que se le pase (`inputs.bun_version`,
sin rebuild) y corre [`tests/parity-probe/cases.mjs`](../tests/parity-probe/cases.mjs)
contra él y contra `node` como referencia. Desde A4 hay un segundo job,
`probe-aarch64`, que corre el mismo archivo contra el `bun-linux-aarch64`
oficial en runner ARM — separa arquitectura de SO cuando un rojo del teléfono
puede ser del backend arm64 de una dependencia vendored. No construye nada del
port: es medición, no productora del ELF (en ubuntu no hay Bionic ni seccomp).

```sh
gh workflow run probe-upstream-parity.yml -f bun_version=1.4.2
gh run watch <run-id>
gh run download <run-id> -n parity-probe-logs           # linux-x64.log, node.log
gh run download <run-id> -n parity-probe-logs-aarch64   # linux-aarch64.log
```

Salida por línea: `nombre|OK|detalle` o `nombre|ROJO|error`. La decisión de
triage se toma comparando: rojo acá + verde upstream ⇒ nuestro (parche); rojo
en ambos ⇒ upstream (doc); verde acá + rojo upstream ⇒ documentación del fix.
Los casos que pueden crashear se corren en **hijo** dentro de la sonda (un
SIGSEGV en el proceso del probe se llevaría el log entero), y los bugs
sensibles al layout de memoria se miden como **tasa** (ej.
`cc_pragma_once_tasa_de_crash_20`: 20 hijos del mismo repro; 12/20 en el
oficial x64, 13/20 en el aarch64, 20/20 en nuestro ELF android).

## Cómo medir antes de parchear

Los gaps de seccomp/API se **median** en el teléfono antes de escribir
cualquier parche (kernel 5.10 del dispositivo soporta varios syscalls que la
lista de riesgos de upstream daba por dudosos):

- SIGSYS vs ENOSYS: rc=159 ⇒ seccomp mata; parchear solo lo medido.
  `fchmodat2`/`close_range`/`epoll_pwait2`: sin SIGSYS medido ⇒ sin parche.
- `RLIMIT_NOFILE`: Termux trae 32768/32768 (`/proc/self/limits`) ⇒ sin bump.
- Heap tagging: estresado sin crashes con el JSC prebuilt oficial ⇒ el ctor
  `android_disable_heap_tagging` zig-era no es necesario aquí.

## Formato de la evidencia en PROGRESS.md

Cada cierre cita: run id de GitHub Actions, sha256 del artifact/binario
instalado, revisión emitida por `bun --revision`, comando del verificador,
fecha y resultado exacto. Un "verde" sin estos campos no cuenta.
