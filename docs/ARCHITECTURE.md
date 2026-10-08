# Arquitectura del port

Mapa de piezas y flujo de datos del repo. Cada caja vive donde dice el
layout del README; este documento solo explica cómo encadenan.

## Componentes

| Pieza | Rol |
|---|---|
| `ci/source-manifest.json` | **fuente de verdad de pins** (upstream commit+sha, JSC, NDK, LLVM, cmake, rust, node, bun host, tinycc). Todo lo que CI baja se deriva de acá. |
| `ci/setup-runner.sh` | instala/usa caché del toolchain pineado en el runner. |
| `ci/link-ndk-runtimes.sh` | symlink `compiler-rt`/`libunwind` del NDK al resource-dir del clang (requisito del link android). |
| `ci/validate-source-tree.sh` | tarball → árbol → `git am` de `patches/android/*.patch` en orden alfabético → **falla si el árbol queda sucio**. Nunca mutaciones fuera de parches. |
| `ci/build-android.sh` | envoltorio del comando canónico `bun scripts/build.ts` (modos y flags en [`BUILD.md`](BUILD.md)); valida el ELF antes de subirlo. |
| `patches/android/000N-*.patch` | adaptaciones bionic/Termux versionadas, una causa por parche, con rationale en [`PATCHES.md`](PATCHES.md). |
| `.github/workflows/build-android.yml` | `host-smoke` (receta) y `android` (cross-build + artifact `bun-aarch64-android`). Read-only; nunca publica. |
| `.github/workflows/release-android.yml` | publicación: consume el artifact de un run android previo, revalida, empaqueta y crea la release. [`RELEASE.md`](RELEASE.md). |
| `scripts/verify-*.sh` | verificadores en dispositivo (instalan solo en `~/.bun-android/bin`). [`VERIFY.md`](VERIFY.md). |
| `docs/` | este set: BUILD, PATCHES, VERIFY, RELEASE, STANDALONE, KNOWN-ISSUES, ROADMAP, PROGRESS (bitácora canónica de evidencia). |

## El flujo, en orden

```
manifest (pins)
  └─> CI baja tarball + verifica sha256
        └─> validate-source-tree: árbol limpio + git am 0001..0007
              └─> build-android.sh: configure→ninja→cargo→link clang++
                    └─> readelf/sha del ELF → artifact bun-aarch64-android
                          ├─> dispositivo: verify-device.sh → ~/.bun-android/bin
                          │     ├─> verificadores dirigidos (sigsys/tmpdir/tinycc + M2)
                          │     └─> batería amplia T1–T9 (battery-device.sh)
                          │           └─> evidencia fechada → PROGRESS.md
                          └─> release-android.yml (solo dispatch, autorizable)
                                └─> GitHub Release (tarball + ELF + sha256.txt)
```

Tres invariantes del diseño:

1. **Determinismo por pin**: el mismo manifest produce el mismo árbol; el
   mismo árbol + parches produce el mismo build (cache keys derivadas por
   hash de los inputs reales).
2. **Fuera del teléfono no se afirma nada, dentro no se compila nada**: el
   build es CI-only; el dispositivo solo instala y ejecuta. Un milestone no
   cierra sin corrida verde en el teléfono.
3. **El fuente upstream se toca solo vía parches versionados**: nada de
   checkouts sucios, nada de sed en CI sobre el árbol, y los parches se
   generan desde árboles mínimos con baseline exacto ([`PATCHES.md`](PATCHES.md)
   § "Cómo agregar").

## Relación con el workspace opencode-termux

Deliberada y limitada: este side project **no** importa ni exporta artefactos
del port cerrado (era-Zig 1.2.13+1.3.2). El único puente posible es M4
(standalone/opencode sobre 1.4.2), hoy pausado con la sonda medida; ver
[`ROADMAP.md`](ROADMAP.md) § 2. Las reglas heredadas que sí se aplican acá
(cache recovery, pins, git am, evidencia) vienen de ese workspace y se
respetan sin que esto lo toque.
