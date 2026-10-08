# Standalone 1.4.2 (`bun build --compile`) — formato medido

Documento de trabajo para el puente M4 (`bun-opencode-bridge`). Todo lo aquí
afirmado está **medido en el teléfono** con el binario del port (sha
`899866c5…`, `1.4.2-canary.1+c23b9c226`); la evidencia crónica está en
[`PROGRESS.md`](PROGRESS.md) § "M4-preliminar".

## Qué funciona ya (medido 2026-10-07)

- `bun build --compile` en android/bionic: **rc=0** generando un ELF
  ejecutable; el riesgo upstream #38246 (`--compile` PIE) no se materializa
  con nuestros parches.
- El standalone corre en el teléfono: hello-world (`probe 42`), eco de
  `Bun.argv`, y con `node_modules` empaquetado (`bun add ms` → `probe2` ⇒
  `dep-probe 1s`).
- La extracción/ejecución no depende de `/data/local/tmp`: el fallback
  parcheado de tmpdir (`0004`) cubre el runtime.

## Dónde vive el grafo (la diferencia estructural vs era-Zig)

El ELF generado **no tiene trailer al EOF**. Medido sobre `probe`
(291.299.504 B): `e_shoff = 291296624`, 45 headers × 64 B ⇒ la tabla de
section headers termina *exactamente* en EOF.

El grafo va **enlazado dentro de la imagen**:

| Pieza | Dónde | Contenido |
|---|---|---|
| descriptor `.bun` (PROGBITS, `WA`, en el LOAD RW) | `0x54c0000`, 0xfa B | u64 longitud + fuente del entry (`// @bun\n// app.mjs\n…`) |
| módulos/manifest | datos estáticos dentro del LOAD RW (p. ej. en `probe2` la string `node_modules/ms` aparece en `0x54C04F7`) | el bundle propiamente dicho |

Consecuencia para el bridge: el lector/ensamblador era-Zig (append al EOF +
escaneo de magic `~bun`) es **estructuralmente insuficiente**. Un reader
1.4.x debe: (1) parsear el ELF, (2) localizar la sección `.bun` por la tabla
de secciones, (3) seguir el descriptor hacia los blobs del LOAD. Un
ensamblador "escribir un grafo nuevo en un runtime dado" es más delicado:
el grafo no se pega, se **enlaza** — hay que reescribir offsets/relocaciones
o replicar lo que hace el `--compile` de bun (que parte del propio binario
en ejecución como plantilla).

## Tamaño y strip

`probe` (una hello-world) pesa 291 MB porque el runtime embebido es el
binario ci-build **con `.debug_*`** (~190 MB de DWARF, secciones 31–41). Para
cualquier standalone útil (opencode apunta a ~100–200 MB realista) hace falta:
`strip` del runtime antes de compilar, o un perfil de build sin debug. Es
palanca tanto del bridge como de una futura release "slim".

## Checklist abierta del puente (no iniciada)

- [ ] Reverse-engineering del layout exacto del descriptor `.bun` + tabla de
      módulos (versionar como fixtures, con round-trip test como pide el
      plan M4).
- [ ] Decidir estrategia de ensamblado: ¿re-link (difícil) vs usar el propio
      `--compile` del runtime android como ensamblador (el bun parcheado ya
      puede emitir standalones — probablemente *ese* es el bridge: no un
      reader externo, sino "compilar opencode con el bun-android")?
- [ ] Stripping del runtime embebido.
- [ ] Compatibilidad opencode↔1.4.2 en scratch (intento pausado; ver
      [`ROADMAP.md`](ROADMAP.md)) — incluye NAPI/opentui, que en 1.4.2 pasan
      por el camino napi+tcc (parcialmente cubierto por `verify-tinycc`).
- [ ] Repo aparte `bun-opencode-bridge` para no arrastrar pins del port
      cerrado (decisión del plan original; revisar si la estrategia
      "compilar con bun-android" lo elimina).
