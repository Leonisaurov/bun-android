# Verificación en dispositivo

Regla de aceptación del proyecto: un hito se cierra con **evidencia corriendo
en el teléfono**, nunca con "compila". Este documento describe el protocolo y
los verificadores. La bitácora de corridas concretas (runs, sha256, fechas)
está en [`PROGRESS.md`](PROGRESS.md).

## Instalación (siempre primero)

```sh
bash scripts/verify-device.sh <path-al-ELF-del-artifact> 1.4.2
```

Instala **solo** en `~/.bun-android/bin/bun` — jamás `~/.local/bin`, que
pertenece al port era-Zig cerrado de `opencode-termux`. Valida `rc=0` y
versión exacta, e imprime el sha256 instalado (ese sha es el que se cita en
la evidencia).

El ELF llega del run `android` de
[`build-android.yml`](../.github/workflows/build-android.yml): artifact
`bun-aarch64-android` (`gh run download <run> -n bun-aarch64-android`).

## Batería de smokes

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
