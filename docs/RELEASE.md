# Publicación (release)

## Política

- Publicar **solo** vía `workflow_dispatch` del workflow
  [`release-android.yml`](../.github/workflows/release-android.yml). Ningún
  push ni run de build crea una release (regla del workspace, heredada).
- La release no reconstruye nada: consume el artifact validado
  (`bun-aarch64-android`) de un run `android` **exitoso y previo** de
  [`build-android.yml`](../.github/workflows/build-android.yml). Si el binario
  cambia, se hace un run nuevo y se publica ese.
- El modo "seguir y reportar, sin publicar" del usuario sigue vigente para el
  contenido: lanzar el dispatch es una decisión explícita, no un paso
  automático del pipeline.

## Procedimiento

1. Confirmar que el binario del run elegido pasó la batería de
   [`VERIFY.md`](VERIFY.md) en el teléfono (verde = evidencia fechada en
   [`PROGRESS.md`](PROGRESS.md)).
2. Elegir el tag: `v<X.Y.Z>-android.<N>` (p. ej. `v1.4.2-android.1`). `<N>`
   se incrementa por cada build publicado, aunque el `X.Y.Z` de upstream no
   cambie. El workflow valida el formato y **rechaza** un tag que ya exista
   (no sobreescribe releases).
3. Dispatch:

   ```sh
   gh workflow run release-android.yml --repo Leonisaurov/bun-android \
     -f run_id=<ID-del-run-android-exitoso> -f tag=v1.4.2-android.1 \
     -f evidence_ref="PROGRESS.md A1 · bateria T1-T8 · run <ID> · sha <SHA>"
   gh run watch <nuevo-run-id> --repo Leonisaurov/bun-android
   ```

   `evidence_ref` es obligatorio (1..200 caracteres, una línea): la release no
   se abre sin decir dónde está la medición en el teléfono.

4. El job publica `Leonisaurov/bun-android` con cuatro assets:
   - `bun-linux-aarch64-android.tar.gz` — directorio
     `bun-linux-aarch64-android/bun` (espejo del layout del zip oficial de
     upstream),
   - `bun-aarch64-android` — el ELF suelto, byte idéntico al artifact,
   - un `.sha256.txt` por cada uno.

## Qué valida el workflow antes de crear nada

- `run_id` numérico y tag con `^v[0-9]+\.[0-9]+\.[0-9]+-android\.[0-9]+$`
  (los inputs nunca se interpolan en comandos más allá de estos checks; todo
  viaja por variables de entorno).
- El run fuente es `build-android`, `completed`/`success`, y de `main`.
- El artifact contiene **exactamente un archivo** y ese archivo es
  ELF64 / AArch64 / `ET_DYN` con `libc.so` en `DT_NEEDED`.
- **Nota sobre `OS/ABI`:** el linker del NDK para un target android emite
  `OS/ABI: UNIX - System V` (no `UNIX Android`), verificado con `readelf -h`
  sobre el artifact propio. El gate histórico exigía `UNIX Android` y por eso
  **ningún dispatch de release podía pasar**. El indicador real de que esto es
  bionic es el `DT_NEEDED libc.so` más la corrida en el teléfono, no el byte
  `e_ident`/`os_abi`.
- sha256 del binario y del tarball calculados y publicados como assets.

El cuerpo de la release enlaza el run origen, su commit y el pin upstream, y
remite a VERIFY.md para la contrapartida de dispositivo. La validación
estática del workflow **no** sustituye la evidencia en el teléfono: publicar
un binario no verificado está prohibido por la regla de aceptación.

## Permisos y límites

- El job corre con `permissions: contents: write` (único workflow del repo
  con write; build-android es read-only).
- No hay rollback automático: una release publicada es inmutable por
  convención; para corregir, se incrementa `-android.N`.
- Retirar/borrar una release existente es una acción manual explícita del
  maintainer (`gh release delete`), fuera del pipeline.
