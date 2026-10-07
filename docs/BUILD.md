# Build — receta y pins

Cómo se construye Bun 1.4.2 para `aarch64-linux-android` en este repo. El
fuente upstream **no se vendoriza ni se submodea**: CI baja el tarball del
commit pineado y lo valida por sha256 (el teléfono tiene ~1.4 GB libres; el
repo de bun es enorme). El build real nunca corre en el dispositivo.

## Comando canónico

Dentro del árbol validado (`ci/validate-source-tree.sh` = tarball limpio +
`git am` de `patches/android/*.patch`):

```sh
bun scripts/build.ts \
    --profile=ci-build --os=linux --arch=aarch64 --abi=android \
    --buildkite=false \
    --android-ndk="$ANDROID_NDK_ROOT" --cache-dir="$HOME/.cache/bun-build"
```

(Envuelto en [`ci/build-android.sh`](../ci/build-android.sh).)

- `bun` aquí es el **bun host pineado** (1.3.13): el builder de 1.4.2 rechaza
  Node < 25 para el codegen, y la entrada documentada por upstream es
  `bun scripts/build.ts`.
- `--buildkite=false`: el perfil `ci-build` implica `buildkite:true`, que
  emite edges ninja `buildkite-agent artifact upload` inexistentes en GitHub
  Actions (run `37629973014`, exit 127).
- El nivel de API **no es un campo CLI** en 1.4.2: aplica
  `ANDROID_API_LEVEL_DEFAULT = 28` de upstream, coherente con el JSC prebuilt
  oficial (compilado contra android28). No bajar de 28.
- El link final lo hace clang++ del host contra el sysroot del NDK; los
  runtimes (`compiler-rt`, `libunwind`) se symlinkan al resource-dir del
  clang con [`ci/link-ndk-runtimes.sh`](../ci/link-ndk-runtimes.sh).

## Pins (fuente de verdad: [`ci/source-manifest.json`](../ci/source-manifest.json))

| Componente | Pin |
|---|---|
| upstream | `oven-sh/bun` @ `744846f8…` (tag `bun-v1.4.2`), tarball sha256 `25e09a88…` |
| JSC | prebuilt `oven-sh/WebKit` `autobuild-2e2aa229…`, asset `bun-webkit-linux-arm64-android.tar.gz` (sha `2a25506c…`) — nunca se compila |
| NDK | r27c |
| LLVM/clang | 21.1.8 (tarball `LLVM-21.1.8-Linux-X64.tar.xz`, no apt.llvm.org) |
| cmake | 3.30.5 (distro **tar.gz**; el self-extractor `.sh` de Kitware falla en el runner) |
| rust | `nightly-2026-07-20` (in-tree `rust-toolchain.toml`; target `aarch64-linux-android` con std prebuilt — sin `-Zbuild-std`) |
| node | 24.3.0 |
| bun host | 1.3.13 |
| tinycc (crate) | `oven-sh/tinycc` @ `05f0fafaa3be…` (el pin zig-era `29985a3b` **no** aplica a 1.4.2) |

Subir cualquiera de estos pins por inferencia está prohibido: los parches
están casados con el commit pineado (regla heredada del port cerrado).

## CI

Workflow [`build-android.yml`](../.github/workflows/build-android.yml)
(`workflow_dispatch`, modos `host-smoke` | `android`):

- purga de disco del runner + caches por componente:
  `ci-cache-v1-toolchain-*` (hash de manifest + `setup-runner.sh` +
  `link-ndk-runtimes.sh`) y `ci-cache-v1-jsc-*` (hash del manifest), con
  `save-always: true`. Cambiar el manifest invalida las keys — esperado.
- `host-smoke` (M0): valida la receta de `scripts/build.ts` construyendo el
  host linux-x64 (`--lto=false` solo ahí).
- `android` (M1+): cross-build real (~11 min con caches calientes) y sube el
  binario como artifact `bun-aarch64-android` (un solo archivo, el ELF
  linkeado; validado con `readelf -h` + `libc.so` DT_NEEDED + sha256 antes de
  subirlo).
- `patches/` y `docs/` **no** entran en las keys de cache (no afectan el
  entorno del runner); sí afectan el build, que los aplica en cada run.

## Fallbacks de riesgo

Si un job no cabe (disco/tiempo): split en `deps-built → cargo-libbun → link`
con intermediates cacheados. El JSC prebuilt de upstream es android28: si no
linka, revisar `--android-api-level` antes que reconstruir WebKit (documentar
cualquier desviación aquí).
