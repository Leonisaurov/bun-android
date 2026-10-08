// Probe de clasificación upstream-vs-port. Corre en CUALQUIER bun 1.4.x (android
// o linux-x64 oficial) y en Node como referencia. No escribe en el repo: todo en
// el cwd. Imprime una linea por caso: "nombre|VEREDICTO|detalle".
//
// Uso: bun tests/parity-probe/cases.mjs      (o node, para la referencia)
const R = [];
const wt = (ms, p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`HANG>${ms}ms`)), ms))]);
const W = async (n, f) => { try { R.push(`${n}|OK|${(await f()) ?? ""}`); } catch (e) { R.push(`${n}|ROJO|${String((e && e.message) || e).slice(0, 170)}`); } };
const isNode = typeof Bun === "undefined";
const D = isNode ? process.cwd() : process.cwd();
const path = (await import("node:path")).default;
const fs = (await import("node:fs")).default;
const file = (name, body) => { const p = path.join(D, name); fs.writeFileSync(p, body); return p; };

// 1) node:worker_threads con globals estilo web (onmessage/postMessage sin importar
//    parentPort). Node: error. Bun 1.3.x: respondia. Bun 1.4.x: ?
await W("worker_bare_onmessage", async () => {
  const wpath = file("pp-worker-bare.mjs", "onmessage = (e) => postMessage('bare:' + e.data);\n");
  const { Worker } = await import("node:worker_threads");
  const w = new Worker(wpath);
  try {
    const got = await wt(8000, new Promise((res, rej) => {
      w.once("message", (m) => res(String(m)));
      w.once("error", (e) => rej(new Error("worker error: " + String(e && e.message).slice(0, 60))));
      w.postMessage("x");
    }));
    if (got !== "bare:x") throw new Error("got=" + got);
    return "despacho por global onmessage";
  } finally { await w.terminate().catch(() => {}); }
});
// 2) La via portable (parentPort) — debe funcionar en todos.
await W("worker_parentport", async () => {
  const wpath = file("pp-worker-pp.mjs",
    "import { parentPort } from 'node:worker_threads';\nparentPort.on('message', (m) => parentPort.postMessage('pp:' + m));\n");
  const { Worker } = await import("node:worker_threads");
  const w = new Worker(wpath);
  try {
    const got = await wt(8000, new Promise((res, rej) => {
      w.once("message", (m) => res(String(m)));
      w.once("error", (e) => rej(new Error(String(e && e.message).slice(0, 60))));
      w.postMessage("y");
    }));
    if (got !== "pp:y") throw new Error("got=" + got);
    return got;
  } finally { await w.terminate().catch(() => {}); }
});
// 3) SharedArrayBuffer + Atomics.wait/notify entre hilos (via portable).
await W("sab_atomics_notify", async () => {
  const wpath = file("pp-worker-sab.mjs", `import { parentPort } from 'node:worker_threads';
parentPort.on('message', (sab) => { const v = new Int32Array(sab);
Atomics.wait(v, 0, 0, 5000); parentPort.postMessage(String(Atomics.load(v, 0))); });
`);
  const { Worker } = await import("node:worker_threads");
  const w = new Worker(wpath);
  const sab = new SharedArrayBuffer(16); const v = new Int32Array(sab);
  try {
    const got = await wt(12000, new Promise((res, rej) => {
      w.once("message", (m) => res(String(m)));
      w.once("error", (e) => rej(new Error(String(e && e.message).slice(0, 60))));
      w.postMessage(sab);
      setTimeout(() => { Atomics.store(v, 0, 77); Atomics.notify(v, 0); }, 150);
    }));
    if (got !== "77") throw new Error("got=" + got);
    return "wake=77";
  } finally { await w.terminate().catch(() => {}); }
});
// 4) EventSource global.
await W("eventsource_defined", () => {
  if (typeof EventSource !== "function") throw new Error("EventSource is not defined");
  const es = new EventSource("http://127.0.0.1:1/none"); es.close(); return "constructible";
});
// 5) BroadcastChannel entre dos canales del mismo proceso (addEventListener).
await W("broadcast_channel_local", async () => {
  const a = new BroadcastChannel("pp-bc"), b = new BroadcastChannel("pp-bc");
  b.addEventListener("message", (e) => b.postMessage("eco:" + e.data));
  try {
    const got = await wt(6000, new Promise((res, rej) => {
      a.addEventListener("message", (e) => res(e.data));
      a.postMessage("hola");
    }));
    if (got !== "eco:hola") throw new Error("got=" + got);
    return got;
  } finally { a.close(); b.close(); }
});
// 6) TLS: servidor Bun.serve + cliente fetch con CA fijada (sin desactivar verificacion).
await W("serve_tls_fetch_ca_pinned", async () => {
  if (isNode) throw new Error("solo-bun (Bun.serve)");
  const { execSync } = await import("node:child_process");
  try {
    execSync('openssl req -x509 -newkey rsa:2048 -keyout pp-k.pem -out pp-c.pem -days 1 -nodes ' +
      '-subj /CN=localhost -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"', { stdio: "pipe" });
  } catch { throw new Error("openssl no disponible"); }
  const s = Bun.serve({ tls: { key: fs.readFileSync("pp-k.pem"), cert: fs.readFileSync("pp-c.pem") },
    hostname: "127.0.0.1", port: 0, fetch: () => new Response("tls-ok") });
  try {
    const r = await wt(12000, fetch(`https://127.0.0.1:${s.port}/`,
      { tls: { ca: fs.readFileSync("pp-c.pem", "utf8"), serverName: "localhost" } }));
    const t = await r.text();
    if (t !== "tls-ok") throw new Error("body=" + t);
    return "handshake con CA fijada";
  } finally { s.stop(); }
});
// 7) TLS con verificacion ACTIVA y CA del sistema: debe fallar (self-signed) y no colgarse.
await W("serve_tls_verify_rejects_selfsigned", async () => {
  if (isNode) throw new Error("solo-bun");
  if (!fs.existsSync("pp-k.pem")) throw new Error("sin cert del caso 6");
  const s = Bun.serve({ tls: { key: fs.readFileSync("pp-k.pem"), cert: fs.readFileSync("pp-c.pem") },
    hostname: "127.0.0.1", port: 0, fetch: () => new Response("no") });
  try {
    const err = await wt(12000, fetch(`https://127.0.0.1:${s.port}/`)
      .then(() => null, (e) => String(e && e.message || e)));
    if (!err) throw new Error("acepto un cert self-signed sin CA (verificacion desactivada?)");
    return "rechazado: " + err.slice(0, 60);
  } finally { s.stop(); }
});
// 8) node:net + node:dgram (sockets crudos).
await W("node_net_echo", async () => {
  const net = await import("node:net");
  const srv = net.createServer((sk) => sk.on("data", (b) => sk.write("eco:" + b)));
  await wt(8000, new Promise((res, rej) => { srv.listen(0, "127.0.0.1", res); srv.on("error", rej); }));
  const port = srv.address().port;
  try {
    const got = await wt(10000, new Promise((res, rej) => {
      const c = net.connect(port, "127.0.0.1", () => c.write("hola"));
      c.once("data", (b) => { res(b.toString()); c.end(); }); c.once("error", rej);
    }));
    if (got !== "eco:hola") throw new Error("got=" + got);
    return got;
  } finally { srv.close(); }
});
await W("node_dgram_echo", async () => {
  const dgram = await import("node:dgram");
  const srv = dgram.createSocket("udp4");
  srv.on("message", (msg, ri) => srv.send(Buffer.from("udp:" + msg), ri.port, ri.address));
  await wt(8000, new Promise((res, rej) => { srv.bind(0, "127.0.0.1", res); srv.on("error", rej); }));
  const port = srv.address().port;
  try {
    const cli = dgram.createSocket("udp4");
    const got = await wt(10000, new Promise((res, rej) => {
      cli.once("message", (m) => res(m.toString())); cli.once("error", rej);
      cli.send(Buffer.from("ping"), port, "127.0.0.1");
    }));
    if (got !== "udp:ping") throw new Error("got=" + got);
    cli.close(); return got;
  } finally { srv.close(); }
});
// 9) Bun.password (hashers nativos) y Bun.Transpiler (cargadores correctos).
await W("password_bcrypt_and_argon2", () => {
  if (isNode) throw new Error("solo-bun");
  for (const algo of ["bcrypt", "argon2id"]) {
    const h = Bun.password.hashSync("clave-123", algo);
    if (!Bun.password.verifySync("clave-123", h)) throw new Error(algo + " nego la clave correcta");
    if (Bun.password.verifySync("mala", h)) throw new Error(algo + " acepto clave incorrecta");
  }
  return "bcrypt + argon2id";
});
await W("transpiler_loader_ts", async () => {
  if (isNode) throw new Error("solo-bun");
  const out = await new Bun.Transpiler({ loader: "ts" }).transform("interface X { a: number }\nconst x: X = { a: 1 };\nexport default x.a;");
  const s = typeof out === "string" ? out : new TextDecoder().decode(out);
  if (s.includes("interface")) throw new Error("no borro interface");
  return s.replace(/\n/g, " ").slice(0, 40);
});
// 10) fs.cpSync + readdir recursive + symlink (semantica de copiado).
await W("fs_cp_recursive_symlink", async () => {
  const base = path.join(D, "pp-tree");
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(path.join(base, "a/b"), { recursive: true });
  fs.writeFileSync(path.join(base, "a/b/deep.txt"), "hondo");
  fs.writeFileSync(path.join(base, "a/src.txt"), "orig");
  fs.symlinkSync("src.txt", path.join(base, "a/lnk.txt"));
  const dst = base + "2";
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(base, dst, { recursive: true });
  const names = [...fs.readdirSync(dst, { recursive: true, encoding: "utf8" })].map(String);
  if (!names.some((n) => n.replace(/\\/g, "/").endsWith("b/deep.txt"))) throw new Error("readdir recursive ciego");
  if (fs.readFileSync(path.join(dst, "a/lnk.txt"), "utf8") !== "orig") throw new Error("symlink no sobrevivio al cp");
  fs.rmSync(dst, { recursive: true, force: true }); fs.rmSync(base, { recursive: true, force: true });
  return "cp + readdir + symlink";
});
// 11) Timezone IANA con TZ del proceso (Android usa /system/usr/share/zoneinfo).
await W("tz_iana_buenos_aires", () => {
  if (!process.env.TZ) return "TZ no fijada en el ambiente (medir con TZ=America/Argentina/Buenos_Aires)";
  const d = new Date("2026-07-10T12:00:00Z");
  const hh = String(d.getHours()).padStart(2, "0");
  const s = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", timeZoneName: "short" })
    .format(new Date(Date.UTC(2026, 6, 10, 12)));
  if (process.env.TZ === "America/Argentina/Buenos_Aires" && hh !== "09") {
    throw new Error(`TZ ambiente no aplicada: getHours=${hh}`);
  }
  return `TZ=${process.env.TZ} getHours=${hh} | London ${s}`;
});
// 12) Orden del constructor JSCallback en 1.4.x (lo cambió upstream?).
await W("jscallback_constructor_order", async () => {
  if (isNode) throw new Error("solo-bun (bun:ffi)");
  const { JSCallback } = await import("bun:ffi");
  const fn = (x) => x + 1;
  const sig = { args: ["i32"], returns: "i32" };
  let viejo = "OK", nuevo = "OK", ptrTipo = "?";
  try { new JSCallback(sig, fn); } catch (e) { viejo = "ROJO:" + String(e.message).slice(0, 40); }
  let cb = null;
  try { cb = new JSCallback(fn, sig); ptrTipo = typeof cb.ptr; } catch (e) { nuevo = "ROJO:" + String(e.message).slice(0, 40); }
  cb?.close?.();
  return `new(sig,fn)=${viejo} | new(fn,sig)=${nuevo} ptr=${ptrTipo}`;
});
// 13) dns.promises.resolve() crudo: cuelga tambien donde SI hay resolv.conf?
await W("dns_raw_resolve", async () => {
  const dns = await import("node:dns/promises");
  const got = await wt(8000, dns.resolve("example.com"));
  return JSON.stringify(got).slice(0, 60);
});
// 14) `bun install` con una dep podada: el lock se limpia (o se borra si queda
// vacio) pero deja node_modules/<dep> materializada y resoluble. Se mide si
// eso es conducta de upstream o de nuestro build.
await W("install_pruned_dep_left_on_disk", async () => {
  if (isNode) throw new Error("solo-bun (bun install)");
  const dir = path.join(D, "pp-prune");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const pkg = (deps) => JSON.stringify({ name: "pp-prune", version: "1.0.0", dependencies: deps }, null, 2);
  fs.writeFileSync(path.join(dir, "package.json"), pkg({ "is-odd": "3.0.1" }));
  const i1 = Bun.spawnSync({ cmd: [process.execPath, "install"], cwd: dir, stdout: "pipe", stderr: "pipe" });
  if (i1.exitCode !== 0) throw new Error("install 1 rc=" + i1.exitCode + " " + i1.stderr.toString().slice(0, 120));
  const dep = path.join(dir, "node_modules/is-odd");
  if (!fs.existsSync(dep)) throw new Error("install 1 no materializo la dep (no se puede medir la poda)");
  fs.writeFileSync(path.join(dir, "package.json"), pkg({}));
  const i2 = Bun.spawnSync({ cmd: [process.execPath, "install"], cwd: dir, stdout: "pipe", stderr: "pipe" });
  if (i2.exitCode !== 0) throw new Error("install 2 rc=" + i2.exitCode + " " + i2.stderr.toString().slice(0, 120));
  const lockFile = ["bun.lock", "bun.lockb"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  const lockMenciona = lockFile
    ? fs.readFileSync(lockFile).toString(lockFile.endsWith(".lock") ? "utf8" : "latin1").includes("is-odd")
    : false;
  const sobrevive = fs.existsSync(dep);
  if (lockMenciona) throw new Error("la dep podada sigue en el lockfile");
  if (sobrevive) {
    throw new Error("node_modules/is-odd sigue materializada y resoluble tras la poda " +
      "(lock: " + (lockFile ? "presente y limpio" : "borrado por estar vacio") + ")");
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return "pruned: fuera de lock y de disco";
});
// 15) C compilado por tinycc que referencia simbolos libc. Sin #include a
// proposito: lo que se mide es la RESOLUCION del simbolo, no las cabeceras
// (nuestro parche 0006 pasa -nostdlib porque Termux no tiene los dirs FHS).
await W("cc_uses_libc_symbols", async () => {
  if (isNode) throw new Error("solo-bun (bun:ffi cc)");
  const { cc, ptr } = await import("bun:ffi");
  const src = path.join(D, "pp-libc.c");
  fs.writeFileSync(src, "extern unsigned long strlen(const char *);\n" +
    "int len_of(const char *s) { return (int)strlen(s); }\n");
  const lib = cc({ source: src, symbols: { len_of: { returns: "i32", args: ["ptr"] } } });
  const { CString } = await import("bun:ffi");
  const c = new CString("hola-vida");
  const n = lib.symbols.len_of(ptr(c));
  c.free?.();
  if (n !== 9) throw new Error("strlen devolvio " + n);
  return "strlen resuelto desde C compilado en runtime";
});
// Clasificacion del crash medido en Termux: ahi <errno.h> mata libtcc con
// SIGSEGV. En HIJO para que el crash no se lleve el resto de la sonda.
await W("cc_include_errno_h", async () => {
  if (isNode) throw new Error("solo-bun (bun:ffi cc)");
  const src = path.join(D, "pp-errno.c");
  fs.writeFileSync(src, "#include <errno.h>\nint f(void) { errno = 0; return errno; }\n");
  const runner = path.join(D, "pp-errno-run.mjs");
  fs.writeFileSync(runner, 'import { cc } from "bun:ffi";\n' +
    'const l = cc({ source: process.argv[2], symbols: { f: { returns: "i32", args: [] } } });\n' +
    'console.log("RET=" + l.symbols.f());\n');
  const r = Bun.spawnSync({ cmd: [process.execPath, runner, src], cwd: D, stdout: "pipe", stderr: "pipe" });
  const out = r.stdout.toString().trim();
  if (r.exitCode !== 0) {
    throw new Error(/panic/.test(r.stderr.toString())
      ? "CRASH de libtcc (rc=" + r.exitCode + " senal)"
      : "rc=" + r.exitCode + " " + (out || r.stderr.toString().replace(/\n/g, " ").slice(0, 90)));
  }
  return out;
});
// Los cuatro stubs medidos en Termux, mas la tabla de coverage y el
// loadExtension de sqlite. En el telefono dan EXACTAMENTE esto mismo en el
// oraculo oficial 1.3.14; si linux-x64 1.4.2 also falla, es gap de la version
// (documentar); si linux-x64 pasa, es gap del build de Android (documentar).
await W("archive_zip_magic", async () => {
  if (isNode) throw new Error("solo-bun (Bun.Archive)");
  const out = path.join(D, "pp-archive.zip");
  await Bun.Archive.write(out, { files: [{ name: "a.txt", data: "hola-a" }] });
  const head = fs.readFileSync(out).subarray(0, 2);
  const magic = String.fromCharCode(head[0], head[1]);
  if (magic !== "PK") throw new Error("magic=" + magic + " size=" + fs.statSync(out).size);
  const files = await new Bun.Archive({ file: Bun.file(out) }).files;
  if (files.length !== 1) throw new Error("files=" + files.length);
  return "zip real con 1 entrada";
});
await W("image_resize_dims", async () => {
  if (isNode) throw new Error("solo-bun (Bun.Image)");
  const src = path.join(D, "pp-px.png");
  fs.writeFileSync(src, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"));
  const img = new Bun.Image(src);
  const w = await img.width, h = await img.height;
  if (w !== 1 || h !== 1) throw new Error("dims=" + w + "x" + h);
  const out = await img.resize(2, 2).png();
  const n = out?.byteLength ?? out?.size ?? 0;
  if (n <= 8) throw new Error("png encode dio " + n + " bytes");
  return "1x1 leido y reencodeado";
});
await W("csrf_verify_mismo_secret", () => {
  if (isNode) throw new Error("solo-bun (Bun.CSRF)");
  const t = Bun.CSRF.generate("clave-super-secreta");
  if (Bun.CSRF.verify("clave-super-secreta", t) !== true) throw new Error("verify devolvio false con el mismo secret");
  if (Bun.CSRF.verify("otra", t) !== false) throw new Error("verify acepta otro secret");
  return "token de " + String(t).length + " bytes verificable";
});
await W("index_of_line_string", () => {
  if (isNode) throw new Error("solo-bun (Bun.indexOfLine)");
  const buf = Bun.indexOfLine(Buffer.from("a\nbb\nccc"), 3);
  const str = Bun.indexOfLine("a\nbb\nccc", 3);
  if (buf !== 4) throw new Error("buffer=" + buf);
  if (str !== 4) throw new Error("string=" + str + " (buffer si da 4)");
  return "string y buffer coinciden";
});
await W("coverage_tabla_en_bun_test", () => {
  if (isNode) throw new Error("solo-bun (bun test)");
  const dir = path.join(D, "pp-cov");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ok.test.ts"),
    "import { test, expect } from \"bun:test\";\ntest(\"s\", () => expect(1+1).toBe(2));\n");
  const r = Bun.spawnSync({ cmd: [process.execPath, "test", "--coverage", "ok.test.ts"],
    cwd: dir, stdout: "pipe", stderr: "pipe" });
  const out = String(r.stdout) + String(r.stderr);
  if (r.exitCode !== 0) throw new Error("rc=" + r.exitCode);
  if (!/%/.test(out)) throw new Error("--coverage no emite tabla de porcentajes");
  return "tabla de cobertura presente";
});
await W("sqlite_load_extension", async () => {
  if (isNode) throw new Error("solo-bun (bun:sqlite)");
  const { Database } = await import("bun:sqlite");
  const db = new Database(":memory:");
  // La libreria a cargar depende de la plataforma: en android apuntamos a la
  // libc (no es una extension de sqlite, pero prueba el camino de dlopen).
  const candidato = process.platform === "android"
    ? "/apex/com.android.runtime/lib64/bionic/libc.so"
    : "/usr/lib/x86_64-linux-gnu/libsqlite3.so";
  try {
    db.loadExtension(candidato);
    return "cargo sin error: " + candidato;
  } catch (e) {
    throw new Error("throw: " + String((e && e.message) || e).slice(0, 90));
  }
});
// El registro cachea por specifier y el segundo atributo se ignora. Si
// linux-x64 hace lo mismo, es semantica de 1.4.x (documentar); si no, hay que
// mirar como lo resuelve nuestro build.
await W("import_attribute_cache_por_specifier", async () => {
  if (isNode) throw new Error("solo-bun (import attributes)");
  const { pathToFileURL } = await import("node:url");
  const abs = path.join(D, "pp-attr.txt");
  fs.writeFileSync(abs, "contenido-embebido");
  const url = pathToFileURL(abs).href;
  const primero = await import(url, { with: { type: "file" } });
  const despues = await import(url, { with: { type: "text" } });
  if (typeof primero.default !== "string") throw new Error("file dio " + typeof primero.default);
  if (despues.default === primero.default) throw new Error("el segundo attribute no re-resuelve: sigue dando la ruta cacheada");
  return "los dos atributos resuelven distinto (el cache no interfiere)";
});
// Dos casos de libtcc, medidos primero en el ELF android (sondas a5* en el
// telefono). Se corren en un HIJO porque uno de ellos esta esperado que
// SIGSEGEE: si crasha en el proceso del probe se lleva el log entero.
const ccRunner = file("pp-cc-run.mjs",
  'import { cc } from "bun:ffi";\n' +
  "const lib = cc({ source: process.argv[2], symbols: { f: { returns: 'i32', args: [] } },\n" +
  "  flags: process.argv[3] || undefined });\n" +
  'console.log("RET=" + lib.symbols.f());\n');
const runCc = async (src, flags) => {
  const p = Bun.spawn({ cmd: [process.execPath, ccRunner, src, flags || ""], cwd: D, stdout: "pipe", stderr: "pipe" });
  const rc = await wt(60000, p.exited);
  let out = "";
  try { out = (await new Response(p.stdout).text()).trim(); } catch {}
  let err = "";
  try { err = (await new Response(p.stderr).text()).trim(); } catch {}
  return { rc, out, err };
};

// (1) Colision de basename con `#pragma once`: en android sega a libtcc. La
//     convencion del log se mantiene: OK = funciona aca, ROJO = falla aca
//     tambien. Device-ROJO + sonda-ROJO => bug de tinycc upstream (atribucion
//     del KNOWN confirmada); device-ROJO + sonda-OK => especifico de nuestro
//     build y hay que abrirlo.
await W("cc_pragma_once_colision_de_basename", async () => {
  if (isNode) throw new Error("solo-bun (bun:ffi cc)");
  const dir = path.join(D, "pp-pragma");
  fs.mkdirSync(path.join(dir, "x"), { recursive: true });
  fs.writeFileSync(path.join(dir, "errno.h"), "#pragma once\n#include <x/errno.h>\n");
  fs.writeFileSync(path.join(dir, "x", "errno.h"), "int marker_pp;\n");
  const src = path.join(dir, "case.c");
  fs.writeFileSync(src, "#include <errno.h>\nint f(void){ return 42; }\n");
  const r = await runCc(src, "-I" + dir);
  if (r.rc !== 0 || r.out !== "RET=42") {
    const err = r.err.split("\n").map((l) => l.trim()).filter(Boolean).slice(-1)[0] || "";
    throw new Error(`falla aca tambien (rc=${r.rc}) ${err}`.slice(0, 90));
  }
  return "compila y corre (RET=42)";
});

// (2) float.h: tcc sirve stddef.h/stdarg.h como headers embebidos; en android
//     NO sirve float.h (y bionic lo necesita desde limits.h). Sonda-OK =
//     linux-x64 si lo sirve => el gap podria ser de nuestra cadena de build y
//     hay que mirarlo; sonda-ROJO = tinycc tampoco lo trae arriba => documentar.
await W("cc_builtin_headers_float_h", async () => {
  if (isNode) throw new Error("solo-bun (bun:ffi cc)");
  const src = file("pp-float.c", "#include <float.h>\nint f(void){ return FLT_RADIX; }\n");
  const r = await runCc(src, "");
  if (r.rc !== 0 || r.out !== "RET=2") {
    const msg = r.err.split("\n").map((l) => l.trim()).filter((l) => /error|not found/i.test(l)).slice(-1)[0] || `rc=${r.rc}`;
    throw new Error(`tampoco aca: ${msg.slice(0, 60)}`);
  }
  return "float.h builtin servido (RET=2)";
});

console.log(`runtime: ${isNode ? "node " + process.version : "bun " + Bun.version}`);
console.log(R.join("\n"));
