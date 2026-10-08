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
  const d = new Date("2026-07-10T12:00:00Z");
  const hh = String(d.getHours()).padStart(2, "0");
  const s = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", timeZoneName: "short" })
    .format(new Date(Date.UTC(2026, 6, 10, 12)));
  if (hh !== "09") throw new Error(`TZ ambiente no aplicada: getHours=${hh}`);
  return `getHours=${hh} (UTC-3) | London ${s}`;
});
console.log(`runtime: ${isNode ? "node " + process.version : "bun " + Bun.version}`);
console.log(R.join("\n"));
