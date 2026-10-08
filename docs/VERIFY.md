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
"paridad total" (bundler, installs grandes o FFI más allá del smoke quedan
fuera de lo afirmado).

## Batería amplia T1–T8

Los cuatro verificadores de arriba son **dirigidos**: cada uno cubre un
parche. La batería mide la superficie en bulk (97 casos, 8 tiers) y fue la
herramienta de la auditoría A1 (`PROGRESS.md`).

```sh
# en tmux, sin bloquear la sesión; capturar el pane
sh -c './scripts/battery-device.sh --json "$PREFIX/tmp/battery-logs/run.json" \
       > "$PREFIX/tmp/battery-logs/run.log" 2>&1'
```

Flags (`--list` imprime el manifiesto sin ejecutar):

| Flag | Efecto |
|---|---|
| `--bun PATH` | binario a testear; por defecto `~/.bun-android/bin/bun` (ruta explícita, nunca PATH) |
| `--tiers T1,T4` | subconjunto de oleadas; sin flag, T1→T8 |
| `--case ID` | un solo caso (debug de fixture) |
| `--json OUT` | `summary.json` con `{bun_sha, bun_revision, tier, case, rc, dur, verdict}` por caso |
| `--min-free-mb N` | gate de disco: aborta **antes** de crear scratch si hay menos espacio |
| `--keep` | no borra el scratch (`$PREFIX/tmp/battery-<sha8>-<pid>`, que tiene `trap` de limpieza) |

Tiers: T1 CLI/exit codes/señales · T2 compat `node:*` (fs, os, worker_threads,
child_process, http, dns) · T3 http y red reales sobre TCP · T4 storage
(`bun:sqlite` archivo+WAL, `Bun.file`, Blob/FormData, `Bun.hash`) · T5
instalador y `bun build`/`bunx` · T6 FFI/TinyCC · T7 `--compile` · T8 edges
Termux (seccomp por syscall, RLIMIT, paths UTF-8/espacios, case-sensitivity,
heap, fd leaks). Manifiesto: [`tests/fixtures/cases.txt`](../tests/fixtures/cases.txt)
(`TIER|archivo|nombre|timeout_ms|expect`); cada caso es un `.mjs` que exita
0/1 y se autolimpia, con helpers en [`tests/fixtures/lib.mjs`](../tests/fixtures/lib.mjs).

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

**Qué no promete la batería**: no es la suite de tests de upstream (esa exige
`RLIMIT`/fixtures propios y queda fuera); no mide rendimiento; no cubre NAPI
nativo ni la plugin API del bundler más allá de `bun build` simple; no prueba
installs grandes ni registry proxies; y no toca el puente M4 standalone (los
casos T7 se autolimitan por disco y borran su ELF de ~291 MB en el mismo paso).

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
