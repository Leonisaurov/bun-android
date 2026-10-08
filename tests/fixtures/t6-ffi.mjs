// T6 · bun:ffi y TinyCC en Bionic: la cadena de gates 0002/0003/0005/0006, mas
// el ABI aarch64 real (ptr, i64, f64) y las limitaciones portadas a proposito.
import { cc, dlopen, FFIType, JSCallback, ptr } from "bun:ffi";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { assert, caseMain, CASE_DIR, eq, skip } from "./lib.mjs";

const P = (...p) => path.join(CASE_DIR, ...p);

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

  cc_libc_reference_limitation: () => {
    // Con el patch 0006 libtcc compila con -nostdlib: referenciar simbolos libc
    // exige resolucion explicita. Se espera FAIL; es la limitacion portada y
    // documentada (docs/KNOWN-ISSUES.md), medida aqui en cada bateria.
    const src = cSource("needslibc.c",
      "extern int getpid(void);\nint mypid(void) { return getpid(); }\n");
    const lib = cc({ source: src, symbols: { mypid: { returns: "i32", args: [] } } });
    const got = lib.symbols.mypid();
    assert(got > 0, "libc resuelta sin resolucion explicita: " + got);
  },
};

export default caseMain(cases);
