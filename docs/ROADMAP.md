# Roadmap

Estado a 2026-10-07. Lo cerrado tiene evidencia fechada en
[`PROGRESS.md`](PROGRESS.md); acá solo queda lo pendiente, con su contexto
de decisión.

## Cerrado

- B0 scaffold · M0 CI toolchain · M1 primer ELF android · M2 smokes Bionic ·
  M3 paridad Termux (parches 0001–0006, batería verde en dispositivo).
- Infra de repo: workflow de build, workflow de publicación (probado en
  negativo), set de docs.

## Pendiente

### 1. Release pública (dispatch listo, falta la orden)

`release-android.yml` está en main y validado (guarda rechaza inputs
inválidos sin crear nada). Publicar = un `workflow_dispatch` con
`run_id=37652505142` (o el run vigente tras re-verificar en el teléfono) y
`tag=v1.4.2-android.1`. **No se dispara sin autorización explícita** (modo
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

### 3. Cierre de M3 residual (opcional, con workload real)

- `BUN_NODE_DIR` (shim node) → patch 0007 si algo lo necesita.
- RLIMIT/heap: reconsiderar solo con demanda medida.

## Fuera de scope de este repo

- El pipeline opencode-era-Zig (workspace, cerrado).
- Publicación de paquetes npm/registros: este repo publica solo releases
  GitHub.
