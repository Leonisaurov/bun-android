# Publicación (release)

## Política

- Publicar **solo** vía `workflow_dispatch` del workflow
  [`release-android.yml`](../.github/workflows/release-android.yml). Ningún
  push ni run de build crea una release (regla del workspace, heredada).
- La release no reconstruye nada: consume el artifact validado
  (`bun-aarch64-android`) de un run `android` **exitoso y previo** de
  [`build-android.yml`](../.github/workflows/build-android.yml). Si el binario
  cambia, se hace un run nuevo y se publica ese.
- Publicar sigue siendo una **decisión explícita del usuario**, no un paso
  automático del pipeline: el modo "seguir y reportar, sin publicar" levantó su
  propia restricción solo para el hito A6, donde la orden fue textual. Ningún
  build nuevo se publica solo.

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
     -f evidence_ref="PROGRESS.md A2 · bateria T1-T9 · run <ID> · sha <SHA>"
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

## Bugs del lane que salieron al despachar (los tres, corregidos antes de publicar)

1. **Segundo gate irremplazablemente falso** (el primero, `OS/ABI`, es el de
   arriba). En la API de runs, `.name` es el *run-name* (`"bun-android android"`),
   no el nombre del workflow. El gate histórico comparaba `"build-android
   completed success"` y por lo tanto **no podía matchear nunca**, ni siquiera
   con el run correcto. Hoy se compara `workflow_id` (el de `build-android.yml`
   en este repo: `377433552`, leído del listado de workflows, no pineado) y
   `head_branch == main`. Se cazó en un dry-run local contra la API real, antes
   de gastar un dispatch.
2. **`gh run download` sin `--repo`.** El job de release no hace checkout, así
   que no hay un repo git que resuelva el nombre: `failed to run git: fatal: not
   a git repository` (run fallido `37849246801`). Con `--repo
   $GITHUB_REPOSITORY` funciona también fuera de un repo.
3. **`Package tarball` hacía `mv` del ELF suelto.** El empaquetado movía
   `bun-aarch64-android` al stage, y el paso de subida lo buscaba en la ruta
   original: `gh` abortó con `no matches found for …/bun-aarch64-android` (run
   fallido `37849466515`). Ahora es `cp`, que es además lo que promete el punto
   4 de arriba (cuatro assets).

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

## Registro · `v1.4.2-android.1` — PUBLICADA 2026-10-08

<https://github.com/Leonisaurov/bun-android/releases/tag/v1.4.2-android.1>

- Run fuente: `build-android` **`37843749634`** (commit `0c087fdb9f37…`,
  `mode=android`) — el ELF del sello `a8-full` de
  [`PROGRESS.md`](PROGRESS.md) A5.
- Run de publicación: **`37849789407`** (`success`, `head_sha 9c728f2e8677…`).
  Los dos intentos previos cayeron en los bugs 2 y 3 de arriba.
- `evidence_ref` del dispatch: `docs/PROGRESS.md A5 (run 37843749634, sha
  3c61913c, sello a8-full: 157 casos, PASS=148, KNOWN=9, 0 inesperados)`.
- Assets (bytes y sha256, los cuatro, como promete el procedimiento):

  | asset | bytes | sha256 |
  |---|---|---|
  | `bun-aarch64-android` | 289397512 | `3c61913c9420c578536225e4f11a85ecf9619a26f6c0094d06b06bff30de31f9` |
  | `bun-linux-aarch64-android.tar.gz` | 219749958 | `404c41d38900af5008ec4253261dec97582d86e130aba21acec2c9669cfc650e` |
  | `bun-aarch64-android.sha256.txt` | 122 | `a2e600f698bab4fe789660cf3185d644111972ce6b7e5de070520b2d53d53123` |
  | `bun-linux-aarch64-android.tar.gz.sha256.txt` | 99 | `4b73c2b9b487282736dcc03dcddf94577b8045543585ae079570d31bd0473ede` |

- **Verificación post-publicación en el teléfono** (la ruta que lee un usuario
  final, no la del artifact interno): se bajaron el tarball y su `.sha256.txt`
  desde la release; el sha medido del tarball coincide con el asset
  autodescriptivo y con el `digest` que reporta la API; `tar -xOzf … | sha256sum`
  del ELF interno da `3c61913c…`, byte a byte el binario instalado en
  `~/.bun-android/bin/bun` y `~/.local/bin/bun`. Ejecutado desde la extracción
  limpia:
  `--version` `1.4.2`, `--revision` `1.4.2-canary.1+0c087fdb9`,
  `Bun.dns.getServers()` → `["8.8.8.8","8.8.4.4"]` (0008 vivo desde el paquete
  publicado) y `Bun.fetch("https://example.com")` → `status=200`.
- Oráculo intacto: `$PREFIX/bin/bun` sigue siendo el 1.3.14 de Termux, y el
  scratch de descarga (`$PREFIX/tmp/rel-verify`) se borró en la misma sesión.
