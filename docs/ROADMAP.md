# Roadmap

Estado a 2026-10-07. Lo cerrado tiene evidencia fechada en
[`PROGRESS.md`](PROGRESS.md); acá solo queda lo pendiente, con su contexto
de decisión.

## Cerrado

- B0 scaffold · M0 CI toolchain · M1 primer ELF android · M2 smokes Bionic ·
  M3 paridad Termux (parches 0001–0006) · **A1 auditoría amplia de superficie**
  (batería T1–T8 de 97 casos en dispositivo, gate de release corregido, parche
  `0007`; 93 PASS / 0 FAIL / 3 KNOWN / 1 SKIP con `31392bde…`).
- **A2 extensión y clasificación** (T1–T9, 126 casos: 121 PASS / 0 FAIL / 5
  KNOWN / 0 SKIP con el mismo ELF `31392bde…`). Los 5 rojos quedan atribuidos
  con el job `probe-upstream-parity` contra el `bun-linux-x64` oficial 1.4.2, y
  la limitación de FFI (`cc()` sin libc) se cerró **midiendo** la receta de
  flags/`BUN_TCC_OPTIONS`, sin parche nuevo.
- Infra de repo: workflow de build, workflow de publicación (probado en
  negativo), set de docs.

## Pendiente

### 1. Release pública (dispatch listo, falta la orden)

`release-android.yml` está en main y validado (guarda rechaza inputs
inválidos sin crear nada), y desde A1 su gate de ELF es real (el patrón
`OS ABI: UNIX Android` que exigía no lo produce nunca `readelf`). Publicar =
un `workflow_dispatch` con `run_id=37727225410` (el binario con el que está
cerrada la evidencia de A1; `run_id=37652505142` es el anterior) +
`tag=v1.4.2-android.1` + `evidence_ref` apuntando al hito A1 de
`PROGRESS.md`. **No se dispara sin autorización explícita** (modo
"seguir y reportar, sin publicar" del usuario). Procedimiento completo:
[`RELEASE.md`](RELEASE.md).

### 2. Puente M4 / standalone con opencode — en pausa con medición hecha

Sonda `--compile` verde y formato del grafo medido: ver
[`STANDALONE.md`](STANDALONE.md). El intento de **build real de opencode
2.0.24 con bun 1.4.2 en scratch** quedó pausado por decisión del usuario
(después de documentar). Cuando se retome:

1. Copiar la fuente opencode del workspace a scratch (`$PREFIX/tmp`, el
   workspace `opencode-termux` NO se toca) o clonar el tag.
2. `bun install` + build script con el bun 1.4.2 y `--compile`; correr la
   TUI en tmux (skill `headless-tui-and-crash-triage`).
3. Los puntos de dolor esperados: NAPI/opentui contra el runtime Rust
   (parcialmente allanado por la ruta napi+tcc verificada en M3), tamaño
   del standalone (strip), y cualquier API que 1.2.13 tenía y 1.4.x movió.

**Hipótesis de diseño a largo plazo** (a confirmar con la build pausada):
el "bridge" puede no ser un reader/ensamblador externo sino *compilar
opencode con el bun-android parcheado* — en cuyo caso `bun-opencode-bridge`
se reduce a la release de este repo + un lane de CI opencode, y el port
cerrado era-Zig queda reemplazable solo cuando la build real sea verde de
punta a punta. No se migra nada del workspace sin esa evidencia.

### 3. Cierre de M3 residual

- [x] `BUN_NODE_DIR` (shim node) → cerrado por el parche `0007` en A1 (era el
  único FAIL de la batería).
- [ ] RLIMIT/heap: reconsiderar solo con demanda medida. La batería A1 estresó
      50 spawns, 256 MB de heap y cientos de fds sin SIGSYS ni crashes.
- [ ] Los 5 `KNOWN` de A2 siguen abiertos, cada uno con su causa atribuida por
      la sonda upstream (runs `37776390386`/`37780014509`):
      `dns.promises.resolve()` cuelga sin `/etc/resolv.conf` (verde en linux-x64 ⇒
      entorno), `bun install` deja la dep podada (rojo también en upstream),
      `EventSource` y los handlers globales de worker (gap de la línea 1.4.x),
      y el SIGSEGV de libtcc con headers bionic compuestos (`errno.h`,
      `unistd.h`, `stdlib.h`, `time.h`, `fcntl.h`, `sys/stat.h`) — eso último
      es trabajo de la dependencia tinycc vendored, con un ciclo de CI por
      hipótesis, y es el único candidato real a "volver verde" algo más.

### 4. Si la superficie crece

La batería vive en el teléfono (no hay Bionic/seccomp en `ubuntu-latest`, así
que un gate de batería en CI sería ruido). Al agregar casos: manifiesto en
`tests/fixtures/cases.txt`, un archivo por tier, y correr la batería **completa**
después de cualquier rebuild — los rojos nuevos valen más que el fix.

## Fuera de scope de este repo

- El pipeline opencode-era-Zig (workspace, cerrado).
- Publicación de paquetes npm/registros: este repo publica solo releases
  GitHub.
