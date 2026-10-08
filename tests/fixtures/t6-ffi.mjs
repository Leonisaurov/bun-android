// T6 · bun:ffi y TinyCC en Bionic: la cadena de gates 0002/0003/0005/0006, mas
// el ABI aarch64 real (ptr, i64, f64) y las limitaciones portadas a proposito.
import { cc, dlopen, FFIType, JSCallback, ptr } from "bun:ffi";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assert, caseMain, CASE_DIR, eq, requirePath, skip, withTimeout } from "./lib.mjs";

const P = (...p) => path.join(CASE_DIR, ...p);

// Rutas reales del dispositivo: bionic vive en el namespace APEX y los headers
// los pone Termux. El prefijo se toma de $PREFIX (env del shell de Termux) con
// el valor estandar de fallback, para no hardcodear una sola instalacion.
const TERMUX_PREFIX = process.env.PREFIX || "/data/data/com.termux/files/usr";
const BIONIC_DIR = "/apex/com.android.runtime/lib64/bionic";
const BIONIC_LIBC = path.join(BIONIC_DIR, "libc.so");
// sys/cdefs.h de Termux aborta (#error "Unversioned target triples") si no le
// declaran el API level minimo: lo pide antes que cualquier header.
const TCC_ANDROID_DEF = "-D__ANDROID_MIN_SDK_VERSION__=28 -D__ANDROID_API__=28";

function cSource(name, code) {
  const f = P(name);
  writeFileSync(f, code);
  return f;
}

const cases = {
  cc_add3_regression: () => {
    const src = cSource("add3.c", "int add3(int a, int b, int c) { return a + b + c; }\n");
    const lib = cc({
      source: src,
      symbols: { add3: { returns: "i32", args: ["i32", "i32", "i32"] } },
    });
    eq(lib.symbols.add3(1, 2, 3), 6, "TinyCC cc() add3 (cadena 0002/0003/0005/0006)");
    eq(lib.symbols.add3(-5, 5, 1), 1, "segunda llamada al codigo generado");
  },

  cc_pointer_and_loop: () => {
    const src = cSource("ptrsum.c",
      "int sum_array(const int *a, int n) { int s = 0; for (int i = 0; i < n; i++) s += a[i]; return s; }\n");
    const lib = cc({ source: src, symbols: { sum_array: { returns: "i32", args: ["ptr", "i32"] } } });
    const buf = new Int32Array([10, 20, 30, 40]);
    const got = lib.symbols.sum_array(ptr(buf), buf.length);
    eq(got, 100, "pointer a memoria JS vista por C compilado en runtime");
  },

  cc_float_and_i64_abi: () => {
    const src = cSource("abi.c",
      "long long mul_i64(long long a, long long b) { return a * b; }\n" +
      "double f64_sum(double a, double b) { return a + b; }\n");
    const lib = cc({
      source: src,
      symbols: {
        mul_i64: { returns: "i64", args: ["i64", "i64"] },
        f64_sum: { returns: "f64", args: ["f64", "f64"] },
      },
    });
    eq(Number(lib.symbols.mul_i64(7n, 6n)), 42, "ABI i64 en aarch64");
    eq(lib.symbols.f64_sum(1.5, 2.25), 3.75, "ABI f64 (registro de punto flotante)");
  },

  dlopen_libc_symbols: () => {
    let lib;
    try {
      lib = dlopen("libc.so", {
        getpid: { args: [], returns: "i32" },
        strlen: { args: ["ptr"], returns: "i32" },
        getpagesize: { args: [], returns: "i32" },
      });
    } catch (e) { skip("dlopen de libc.so fallo: " + e.message); }
    const pid = lib.symbols.getpid();
    eq(pid, process.pid, "getpid por dlopen coincide con el proceso");
    const s = "ñá";
    const buf = Buffer.from(s + "\0", "utf8");
    eq(lib.symbols.strlen(ptr(buf)), Buffer.byteLength(s), "strlen ve el UTF-8 de JS");
    assert(lib.symbols.getpagesize() > 0, "getpagesize");
  },

  cc_callback_into_js: () => {
    const src = cSource("cb.c",
      "typedef int (*cb_t)(int);\n" +
      "int apply_twice(cb_t f, int x) { return f(f(x)); }\n");
    const lib = cc({ source: src, symbols: { apply_twice: { returns: "i32", args: ["ptr", "i32"] } } });
    // 1.4.x invierte el orden del constructor: `new JSCallback(cb, options)` y
    // el puntero nativo se expone en `.ptr`. Con el orden viejo (options, cb)
    // lanza "Expected callback function"; es un builtin de JS del runtime, no
    // codigo parcheado por nosotros.
    let cb;
    try {
      cb = new JSCallback((x) => x + 1, { args: ["i32"], returns: "i32" });
    } catch (e) {
      skip("JSCallback no se pudo construir en este runtime: " + e.message);
    }
    const fnptr = cb.ptr;
    assert(typeof fnptr === "number" && fnptr > 0, "el callback expone un puntero numerico: " + fnptr);
    eq(lib.symbols.apply_twice(fnptr, 40), 42, "C llama de vuelta a JS (callback ABI)");
    cb.close();
  },

  // El default android del patch 0006 es -nostdlib: el codigo que referencia
  // simbolos libc tiene que pedirlos explícitamente. La resolucion existe y es
  // una receta de uso, no un gap del port: `-L<dir bionic> -lc` como flags de
  // cc() (medido: flags REEMPLAZA el default, por eso -nostdlib no va incluido).
  cc_libc_symbols_resueltos_con_flags: () => {
    requirePath(BIONIC_LIBC, "libtcc necesita la libc real de bionic");
    const src = cSource("needslibc.c",
      "extern int getpid(void);\n" +
      'extern unsigned long strlen(const char*);\n' +
      "int mypid(void) { return getpid(); }\n" +
      'int len(void) { return (int)strlen("abcdef"); }\n');
    const lib = cc({
      source: src,
      flags: `-L${BIONIC_DIR} -lc`,
      symbols: {
        mypid: { returns: "i32", args: [] },
        len: { returns: "i32", args: [] },
      },
    });
    eq(lib.symbols.mypid(), process.pid, "getpid de libc resuelto por -lc (mismo proceso)");
    eq(lib.symbols.len(), 6, "strlen resuelto por -lc");
  },

  // El default android del port NO linkea libc (es -nostdlib a proposito). Para
  // todo el proceso hay un escape hatch de upstream: BUN_TCC_OPTIONS reemplaza
  // las flags de libtcc (ffi_body.rs:619). Se mide en un HIJO porque el env de
  // la bateria es comun y este caso necesita el suyo propio.
  cc_libc_por_bun_tcc_options: async () => {
    requirePath(BIONIC_LIBC, "libtcc necesita la libc real de bionic");
    const src = cSource("needslibc-env.c",
      "extern int getpid(void);\nint mypid(void) { return getpid(); }\n");
    const runner = P("run-env.mjs");
    writeFileSync(runner,
      'import { cc } from "bun:ffi";\n' +
      'const l = cc({ source: process.argv[2], symbols: { mypid: { returns: "i32", args: [] } } });\n' +
      'console.log("P=" + l.symbols.mypid());\n');
    const child = Bun.spawn({
      cmd: [process.execPath, runner, src],
      cwd: CASE_DIR,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, BUN_TCC_OPTIONS: `-std=c11 -L${BIONIC_DIR} -lc` },
    });
    const rc = await withTimeout(45000, () => child.exited);
    const out = await new Response(child.stdout).text();
    eq(rc, 0, `rc del hijo con BUN_TCC_OPTIONS: ${rc} ${out.slice(0, 80)}`);
    eq(out.trim(), `P=${child.pid}`, "el getenv de tcc linkea libc y getpid coincide con el hijo");
  },

  // Headers bionic que tcc SI parsea (con los defines que exige sys/cdefs.h).
  cc_headers_bionic_que_tcc_parsea: () => {
    requirePath(`${TERMUX_PREFIX}/include/string.h`, "headers de Termux");
    requirePath(BIONIC_LIBC, "libc real de bionic");
    const flags = `${TCC_ANDROID_DEF} -I${TERMUX_PREFIX}/include -L${BIONIC_DIR} -lc`;
    const s = cSource("hdr-string.c",
      '#include <string.h>\nint f(void){ return (int)strlen("abcdef"); }\n');
    const libS = cc({ source: s, flags, symbols: { f: { returns: "i32", args: [] } } });
    eq(libS.symbols.f(), 6, "string.h de bionic compila y strlen responde");
    const io = cSource("hdr-stdio.c",
      '#include <stdio.h>\nint f(void){ return snprintf(0, 0, "a%d", 7); }\n');
    const libI = cc({ source: io, flags, symbols: { f: { returns: "i32", args: [] } } });
    eq(libI.symbols.f(), 2, "stdio.h compila y snprintf devuelve el largo");
  },

  // Crash medido: ciertos headers bionic matan libtcc (SIGSEGV en la etapa de
  // compile, no de enlace). El caso se corre en un HIJO para que el crash no se
  // lleve la bateria. KNOWN por el conjunto completo de headers; la causa y la
  // receta están medidas en cc_pragma_once_colision_de_basename_con_recipe.
  cc_headers_bionic_con_crash: async () => {
    requirePath(`${TERMUX_PREFIX}/include/errno.h`, "headers de Termux");
    const flags = `${TCC_ANDROID_DEF} -I${TERMUX_PREFIX}/include -L${BIONIC_DIR} -lc`;
    const src = cSource("hdr-errno.c", '#include <errno.h>\nint f(void){ return 1; }\n');
    const runner = P("run-errno.mjs");
    writeFileSync(runner,
      'import { cc } from "bun:ffi";\n' +
      `const lib = cc({ source: process.argv[2], symbols: { f: { returns: "i32", args: [] } }, flags: ${JSON.stringify(flags)} });\n` +
      'console.log("RET=" + lib.symbols.f());\n');
    const r = await withTimeout(45000, () => Bun.spawn({
      cmd: [process.execPath, runner, src], cwd: CASE_DIR, stdout: "pipe", stderr: "pipe",
    }).exited);
    eq(r, 0, "errno.h de bionic compila sin matar el proceso");
  },

  // Causa del crash anterior, acotada a dos lineas de header (A5, sondas
  // a5c..a5h en $PREFIX/tmp): libtcc sega —en este ELF, 20/20— cuando un
  // archivo declarado con `#pragma once` trae por debajo OTRO archivo con el
  // mismo basename. Bionic lo pica en la ruta real porque `errno.h` usa pragma
  // once e incluye `<linux/errno.h>`. Atribucion por sonda upstream (runs
  // 37792716755/37793508977/37793514722): el repro sintetico sega 3/3 en el
  // OFICIAL linux-aarch64 y 1/4 en el OFICIAL linux-x64 => bug latente de la
  // libtcc vendored, sensible a la arquitectura/layout de memoria; no viene
  // de nuestros parches. La receta medida: un shadow-dir con el pragma
  // quitado, que ademas deja `errno` funcional.
  cc_pragma_once_colision_de_basename_con_recipe: async () => {
    requirePath(`${TERMUX_PREFIX}/include/errno.h`, "headers de Termux");
    const runner = P("run-pragma.mjs");
    writeFileSync(runner,
      'import { cc } from "bun:ffi";\n' +
      "const lib = cc({ source: process.argv[2], symbols: { f: { returns: \"i32\", args: [] } },\n" +
      "  flags: process.argv[3] });\n" +
      'console.log("RET=" + lib.symbols.f());\n');

    const run = async (src, flags) => {
      const p = Bun.spawn({ cmd: [process.execPath, runner, src, flags], cwd: CASE_DIR, stdout: "pipe", stderr: "ignore" });
      const rc = await withTimeout(45000, () => p.exited);
      const out = (await new Response(p.stdout).text()).trim();
      return { rc, out };
    };

    // (a) repro minimo: errno.h con pragma once que incluye x/errno.h.
    const col = P("col");
    mkdirSync(path.join(col, "x"), { recursive: true });
    writeFileSync(path.join(col, "errno.h"), "#pragma once\n#include <x/errno.h>\n");
    writeFileSync(path.join(col, "x", "errno.h"), "int marker_col;\n");
    const srcCol = path.join(col, "case.c");
    writeFileSync(srcCol, "#include <errno.h>\nint f(void){ return 42; }\n");
    const base = (dir) => `-I${dir} ${TCC_ANDROID_DEF} -I${TERMUX_PREFIX}/include -L${BIONIC_DIR} -lc`;
    const crash = await run(srcCol, base(col));
    assert(crash.rc === 139 || crash.rc === 134, "la colision de basename debe matar al hijo (si deja de morir, tinycc se arreglo y hay que re-leer este caso): rc=" + crash.rc);

    // (b) mismo contenido sin `#pragma once`: verde => el pragma es el disparador.
    writeFileSync(path.join(col, "errno.h"), "#include <x/errno.h>\n");
    const sinPragma = await run(srcCol, base(col));
    eq(sinPragma.out, "RET=42", "sin pragma once la misma cadena compila");

    // (c) con pragma pero en otro basename (otro.h -> x/errno.h): verde => es
    // la colisión de nombres, no el pragma a secas.
    writeFileSync(path.join(col, "otro.h"), "#pragma once\n#include <x/errno.h>\n");
    const srcOtro = path.join(col, "case2.c");
    writeFileSync(srcOtro, "#include <otro.h>\nint f(void){ return 42; }\n");
    const otro = await run(srcOtro, base(col));
    eq(otro.out, "RET=42", "pragma once con basename distincto compila");

    // (d) la receta sobre el header real: copia de errno.h sin el pragma, con
    // -I del shadow DELANTE, y `errno` de verdad funcionando (EAGAIN = 11).
    const shadow = P("shadow");
    mkdirSync(shadow, { recursive: true });
    const real = readFileSync(`${TERMUX_PREFIX}/include/errno.h`, "utf8");
    assert(real.includes("#pragma once"), "el errno.h de bionic usa pragma once (si cambio, revisar la receta)");
    writeFileSync(path.join(shadow, "errno.h"), real.replace("#pragma once\n", ""));
    const srcRecipe = P("recipe.c");
    writeFileSync(srcRecipe, '#include <errno.h>\nint f(void){ errno = EAGAIN; return errno; }\n');
    const recipe = await run(srcRecipe, base(shadow));
    eq(recipe.rc, 0, "la receta no mata el proceso");
    eq(recipe.out, "RET=11", "errno funcional con el shadow delante (EAGAIN=11)");
  },

  // Receta para el conjunto COMPLETO de headers bionic que crashean (sonda
  // t6-clang-e en $PREFIX/tmp): preprocesar con clang -E y entregarle a tcc el
  // resultado plano, sin la cadena de #include. Tres filtros, cada uno medido
  // contra el error real de tcc:
  //   - lineas `__int128`: tcc no conoce el keyword y bionic lo usa en los
  //     typedefs `__s128`/`__u128` de sys/types.h (`error: ';' expected`).
  //   - lineas `__overloadable__`: bionic declara `ioctl` dos veces con tipos
  //     distintos (`error: incompatible types for redefinition`).
  //   - anotaciones `_Nullable`/`_Nonnull`/`_Null_unspecified`.
  // Sin el crash (rc=139) desaparece: cc() compila y `errno` funciona.
  cc_headers_bionic_via_clang_preprocesado: async () => {
    requirePath(`${TERMUX_PREFIX}/include/errno.h`, "headers de Termux");
    const clang = Bun.which("clang");
    if (!clang) skip("clang no esta instalado: no hay preprocesador alternativo");
    const src = cSource("hdr-all.c",
      "#include <errno.h>\n#include <unistd.h>\n#include <stdlib.h>\n#include <string.h>\n" +
      "#include <time.h>\n#include <fcntl.h>\n#include <sys/stat.h>\n" +
      "int f(void) {\n" +
      "  struct stat st; char *p = (char*)malloc(8); memcpy(p, \"ok\", 3);\n" +
      "  errno = EAGAIN; time_t t = time(0);\n" +
      "  int fd = open(\"/dev/null\", O_RDONLY); int r = fd >= 0 ? 1 : 0; if (fd >= 0) close(fd);\n" +
      "  stat(\"/dev/null\", &st); free(p);\n" +
      "  return (errno == EAGAIN && r && t) ? 7 : 0;\n}\n");

    const pre = Bun.spawn({ cmd: [clang, "-E", "-std=gnu11", src, "-o", P("hdr-all.i")], cwd: CASE_DIR, stderr: "pipe" });
    const rcPre = await withTimeout(90000, () => pre.exited);
    eq(rcPre, 0, "clang -E sobre la cadena de headers: " + (await new Response(pre.stderr).text()).slice(0, 140));

    const flat = readFileSync(P("hdr-all.i"), "utf8")
      .replace(/^#[ \t].*$/gm, "")
      .replace(/_Null_?[a-z_]*/g, "")
      .replace(/__extension__ /g, "")
      .replace(/^.*__int128.*$/gm, "")
      .replace(/^.*__overloadable__.*$/gm, "");
    const flatPath = P("hdr-all-flat.c");
    writeFileSync(flatPath,
      "#define ioctl __tcc_no_ioctl\n" +
      "typedef struct { long lo, hi; } __s128;\n" +
      "typedef struct { unsigned long lo, hi; } __u128;\n" + flat);

    const runner = P("run-flat.mjs");
    writeFileSync(runner,
      'import { cc } from "bun:ffi";\n' +
      "const lib = cc({ source: process.argv[2], symbols: { f: { returns: \"i32\", args: [] } },\n" +
      "  flags: process.argv[3] });\n" +
      'console.log("RET=" + lib.symbols.f());\n');
    const p = Bun.spawn({
      cmd: [process.execPath, runner, flatPath, `${TCC_ANDROID_DEF} -L${BIONIC_DIR} -lc`],
      cwd: CASE_DIR, stdout: "pipe", stderr: "pipe",
    });
    const rc = await withTimeout(90000, () => p.exited);
    const out = (await new Response(p.stdout).text()).trim();
    const err = (await new Response(p.stderr).text()).trim();
    eq(rc, 0, `el hijo plano sobrevive (rc=${rc}) :: ${out.slice(0, 60)} ${err.slice(0, 140)}`);
    eq(out, "RET=7", "errno/unistd/time/stat/fcntl preprocesados compilan y corren");
  },
};

export default caseMain(cases);
