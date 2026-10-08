// T9 · APIs de producto que la batería no tocaba: el transpiler, el hash de
// claves y los dos gaps de 1.4.x que quedaron clasificados como upstream por
// medicion en el binario oficial linux-x64 (ver docs/KNOWN-ISSUES.md).
import { Worker } from "node:worker_threads";
import path from "node:path";
import { assert, caseMain, CASE_DIR, eq, withTimeout } from "./lib.mjs";

const P = (...p) => path.join(CASE_DIR, ...p);

const cases = {
  // `lang:` sigue siendo una opcion VALIDA pero obsoleta; con un loader
  // equivocado el parseo se va a jsx y falla. Se fija `loader`.
  transpiler_ts_y_tsx_loaders: async () => {
    const t = new Bun.Transpiler({ loader: "ts" });
    const out = await t.transform("interface X { a: number }\nconst x: X = { a: 1 };\nexport default x.a;");
    const s = typeof out === "string" ? out : new TextDecoder().decode(out);
    assert(!s.includes("interface"), "el loader ts borra la interface: " + s.slice(0, 60));
    assert(!s.includes(": number"), "el loader ts borra los tipos: " + s.slice(0, 60));
    const tsx = new Bun.Transpiler({ loader: "tsx" });
    const j = tsx.transformSync("const f = (n: number): string => <b>{n}</b>;");
    assert(!j.includes(": number"), "tsx saca los tipos del jsx: " + j.slice(0, 80));
    assert(/b|jsx|createElement/.test(j), "tsx deja el arbol jsx visible: " + j.slice(0, 80));
  },

  transpiler_minify_y_scan_imports: () => {
    const min = new Bun.Transpiler({ loader: "js", minify: true })
      .transformSync("export function largoNombre(a, b) { return a + b; }");
    // medido: `export function largoNombre(r,o){return r+o}` — el nombre
    // exportado se conserva, los parametros se renombran y el espacio se va.
    assert(!/function largoNombre\(a, b\)/.test(min), "minify renombra los parametros: " + min);
    assert(!min.includes("{ return"), "minify saca el espacio del cuerpo: " + min);
    assert(min.length < 60, "la salida minificada es corta: " + min.length + " bytes");
    const imports = new Bun.Transpiler({ loader: "js" })
      .scanImports("import { a } from './m1'; import b from 'pkg/x'; export * from './m2';");
    eq(imports.length, 3, "scanImports ve los tres imports");
    const paths = imports.map((i) => i.path);
    assert(paths.includes("./m1"), "scanImports ve el relativo: " + JSON.stringify(imports));
    assert(paths.includes("pkg/x"), "scanImports ve el paquete: " + JSON.stringify(imports));
    assert(imports.every((i) => i.kind === "import-statement"), "kind declarado por el scan: " + JSON.stringify(imports[0]));
  },

  password_bcrypt_y_argon2id: () => {
    const b = Bun.password.hashSync("clave-de-bateria", "bcrypt");
    assert(Bun.password.verifySync("clave-de-bateria", b), "bcrypt acepta la clave correcta");
    assert(!Bun.password.verifySync("clave-tocada", b), "bcrypt rechaza la clave equivocada");
    assert(b.startsWith("$2"), "el hash bcrypt tiene su prefijo: " + b.slice(0, 8));
    const a = Bun.password.hashSync("clave-de-bateria", "argon2id");
    assert(Bun.password.verifySync("clave-de-bateria", a), "argon2id acepta la clave correcta");
    assert(!Bun.password.verifySync("otra", a), "argon2id rechaza la clave equivocada");
    assert(a.startsWith("$argon2id$"), "el hash argon2id tiene su prefijo: " + a.slice(0, 12));
    // Medido tambien en el oraculo 1.3.14: un hash malformado NO devuelve
    // false, lanza UnsupportedAlgorithm. El contrato es "explota", no "false".
    let lanzo = null;
    try { Bun.password.verifySync("clave-de-bateria", "no-un-hash"); } catch (e) { lanzo = String(e.message); }
    assert(lanzo && /UnsupportedAlgorithm/.test(lanzo), "verifySync con hash basura lanza UnsupportedAlgorithm: " + lanzo);
  },

  // KNOWN · upstream: el bun 1.4.2 OFICIAL linux-x64 (revision 1.4.2+744846f84,
  // sha a83d263767d8…, run 37776390386) tampoco define EventSource, igual que
  // el oráculo 1.3.14 de Termux. No es un gap del port: se documenta.
  eventsource_global_available: () => {
    eq(typeof EventSource, "function", "EventSource como global");
  },

  // KNOWN · upstream: un worker que usa el handler global estilo web (sin
  // importar parentPort) nunca responde en 1.4.x — cuelga silencioso también
  // en el binario oficial linux-x64 (mismo run). Node tira ReferenceError; bun
  // 1.3.x despachaba estos handlers. La ruta portable es parentPort (T2).
  worker_bare_onmessage_global: async () => {
    const wsrc = P("worker-bare.mjs");
    await Bun.write(wsrc, "onmessage = (e) => postMessage('eco:' + e.data);\n");
    const w = new Worker(wsrc);
    try {
      const got = await withTimeout(8000, () => new Promise((res, rej) => {
        w.once("message", (m) => res(String(m)));
        w.once("error", (e) => rej(new Error("worker: " + e.message)));
        w.postMessage("hola");
      }));
      eq(got, "eco:hola", "el worker global onmessage responde");
    } finally { await w.terminate(); }
  },
};

export default caseMain(cases);
