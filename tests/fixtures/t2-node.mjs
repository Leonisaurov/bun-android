// T2 · node builtins under Bionic: fs/os/path, worker_threads, child_process,
// node:http, dns, crypto. Each case runs in its own process (see the runner).
import cp from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter, once, on as evOn } from "node:events";
import {
  chmodSync,
  cpSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  watch,
  writeFileSync,
  promises as fsp,
} from "node:fs";
import dns from "node:dns";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import util from "node:util";
import { Worker } from "node:worker_threads";
import { assert, caseMain, CASE_DIR, eq, selfSignedCert, skip, withTimeout } from "./lib.mjs";

const P = (...p) => path.join(CASE_DIR, ...p);

const cases = {
  fs_symlink_and_realpath: async () => {
    const target = P("real.txt");
    const link = P("link.txt");
    writeFileSync(target, "contenido");
    try { symlinkSync(target, link); } catch (e) { skip("el filesystem no soporta symlinks: " + e.code); }
    assert(lstatSync(link).isSymbolicLink(), "lstat debe ver el symlink");
    eq(readFileSync(link, "utf8"), "contenido", "leer a traves del symlink");
    const rp = await fsp.realpath(link);
    eq(rp, realpathSync(link), "promises.realpath coincide con realpathSync");
    eq(path.basename(rp), "real.txt", "realpath resuelve al destino");
  },

  fs_watch_event: async () => {
    const f = P("watched.txt");
    writeFileSync(f, "a");
    const seen = await withTimeout(9000, () =>
      new Promise((resolve, reject) => {
        let w;
        try {
          w = watch(f, (event) => { if (event) { resolve(event); try { w.close(); } catch {} } });
        } catch (e) { reject(new Error("fs.watch no se pudo crear: " + e.message)); return; }
        setTimeout(() => { try { writeFileSync(f, "ab"); } catch (e) { reject(e); } }, 500);
      }),
    );
    assert(typeof seen === "string" && seen.length > 0, "evento de fs.watch: " + JSON.stringify(seen));
  },

  fs_rename_and_metadata: () => {
    const a = P("meta-a.txt"), b = P("meta-b.txt");
    writeFileSync(a, "x".repeat(1234));
    // Termux trae umask 0077: el modo del create() queda enmascarado, asi que
    // el modo se fija explicitamente y lo que se mide es que rename lo conserve.
    chmodSync(a, 0o640);
    eq((statSync(a).mode & 0o777).toString(8), "640", "chmod antes del rename");
    renameSync(a, b);
    assert(!existsSync(a) && existsSync(b), "rename movio el archivo");
    eq(statSync(b).size, 1234, "size tras rename");
    eq((statSync(b).mode & 0o777).toString(8), "640", "mode preservado por rename");
  },

  fs_utf8_spaces_and_dotdot_names: () => {
    const weird = P("a file with spaces ñá 世界.txt");
    writeFileSync(weird, "utf8 ✓");
    eq(readFileSync(weird, "utf8"), "utf8 ✓", "ronda de nombre UTF-8 con espacios");
    const dir = P("dir ñ/sub");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "f.bin"), Buffer.from([0, 1, 255, 128]));
    eq(readFileSync(path.join(dir, "f.bin")).length, 4, "mkdir -r con acentos + binario");
  },

  fs_stream_large_write_read: async () => {
    const f = P("big.bin");
    const size = 16 * 1024 * 1024;
    const chunk = Buffer.alloc(1024 * 1024, 0xab);
    await new Promise((resolve, reject) => {
      const ws = createWriteStream(f);
      ws.on("error", reject);
      ws.on("close", resolve);
      for (let i = 0; i < 16; i++) ws.write(chunk);
      ws.end();
    });
    eq(statSync(f).size, size, "16 MB escritos");
    let n = 0;
    for await (const c of Bun.file(f).stream()) n += c.length ?? c.byteLength;
    eq(n, size, "16 MB leidos por stream");
  },

  fs_promises_and_rm_tree: async () => {
    const root = P("tree");
    await fsp.mkdir(path.join(root, "nested", "deeper"), { recursive: true });
    await fsp.writeFile(P("tree", "a.txt"), "a");
    await fsp.writeFile(P("tree", "nested", "deeper", "b.txt"), "b");
    const entries = await fsp.readdir(root, { withFileTypes: true });
    assert(entries.length >= 2, "readdir con withFileTypes");
    eq(await fsp.readFile(P("tree", "nested", "deeper", "b.txt"), "utf8"), "b", "lectura anidada");
    rmSync(root, { recursive: true, force: true });
    assert(!existsSync(root), "rmSync recursive limpio");
  },

  os_infos: () => {
    eq(os.platform(), "android", "os.platform");
    assert(["arm64", "x64"].includes(os.arch()), "os.arch: " + os.arch());
    assert(os.cpus().length > 0, "os.cpus no vacio");
    assert(os.totalmem() > 512 * 1024 * 1024, "os.totalmem plausible: " + os.totalmem());
    assert(os.freemem() > 0, "os.freemem > 0");
    assert(os.tmpdir().length > 0, "os.tmpdir no vacio");
    assert(os.homedir().length > 0, "os.homedir no vacio");
    assert(Object.keys(os.networkInterfaces()).length > 0,
      "networkInterfaces: " + JSON.stringify(os.networkInterfaces()));
    eq(os.EOL, "\n", "EOL unix");
    assert(typeof os.uptime() === "number", "uptime");
  },

  worker_threads_ping_pong: async () => {
    const workerSrc = P("worker.mjs");
    writeFileSync(workerSrc,
      "import { parentPort } from 'node:worker_threads';\n" +
      "parentPort.on('message', (m) => parentPort.postMessage(m.n * 2));\n");
    const got = await withTimeout(15000, () => new Promise((resolve, reject) => {
      const w = new Worker(workerSrc);
      const t = setTimeout(() => { w.terminate(); reject(new Error("worker no respondio")); }, 14000);
      w.once("message", (v) => { clearTimeout(t); w.terminate().then(() => resolve(v)); });
      w.once("error", (e) => { clearTimeout(t); reject(new Error("worker error: " + e.message)); });
      w.postMessage({ n: 21 });
    }));
    eq(got, 42, "worker_threads ida y vuelta");
  },

  worker_threads_env_and_threads_data: async () => {
    const workerSrc = P("worker2.mjs");
    writeFileSync(workerSrc,
      "import { parentPort, workerData, threadId } from 'node:worker_threads';\n" +
      "parentPort.postMessage({ sum: workerData.a + workerData.b, tid: typeof threadId, env: process.env.WORKER_ENV });\n");
    const got = await withTimeout(15000, () => new Promise((resolve, reject) => {
      const w = new Worker(workerSrc, { workerData: { a: 20, b: 22 }, env: { WORKER_ENV: "si" } });
      w.once("message", resolve);
      w.once("error", (e) => reject(new Error("worker2: " + e.message)));
    }));
    eq(got.sum, 42, "workerData llega");
    eq(got.tid, "number", "threadId es number");
    eq(got.env, "si", "env por worker");
  },

  child_process_spawn_buffer_and_exit: async () => {
    const execFile = util.promisify(cp.execFile);
    const { stdout } = await execFile(process.execPath, ["-e", "process.stdout.write(Buffer.from([104,105]))"]);
    eq(stdout, "hi", "execFile con stdout binario");
    try {
      await execFile(process.execPath, ["-e", "process.exit(9)"]);
      assert(false, "debio fallar con rc 9");
    } catch (e) { eq(e.code, 9, "codigo de salida propagado por execFile"); }
  },

  child_detached_and_stdio_inherit: async () => {
    const p = cp.spawnSync(process.execPath, ["-e", "console.log('inherit-ok')"], { stdio: ["ignore", "pipe", "pipe"] });
    eq(p.status, 0, "spawnSync status");
    eq(p.stdout.toString().trim(), "inherit-ok", "spawnSync stdout");

    const stamp = P("detach-stamp.txt");
    const script = P("detach-me.mjs");
    writeFileSync(script,
      'import { writeFileSync } from "node:fs";\n' +
      "writeFileSync(process.env.STAMP, 'done');\nawait Bun.sleep(1500);\n");
    const child = cp.spawn(process.execPath, ["run", script], {
      detached: true, stdio: "ignore", env: { ...process.env, STAMP: stamp },
    });
    child.unref();
    assert(child.pid > 0, "detached pid");
    await withTimeout(9000, () => new Promise((resolve, reject) => {
      const t = setInterval(() => { if (existsSync(stamp)) { clearInterval(t); resolve(); } }, 100);
      setTimeout(() => { clearInterval(t); reject(new Error("el hijo detached murio al unref")); }, 8500);
    }));
  },

  node_http_server_roundtrip: async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("node-http " + req.method + " " + req.url);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const r = await withTimeout(10000, () => fetch(`http://127.0.0.1:${port}/ruta`));
    const body = await r.text();
    await new Promise((r) => server.close(r));
    eq(r.status, 200, "node:http status");
    eq(body, "node-http GET /ruta", "node:http cuerpo");
  },

  node_dns_lookup: async () => {
    // El camino soportado en Bionic: dns.lookup usa getaddrinfo (el resolver
    // del sistema). La resolucion DNS cruda se mide aparte como KNOWN.
    const lookup = util.promisify(dns.lookup);
    const res = await withTimeout(10000, () => lookup("localhost"));
    assert(typeof res.address === "string" && res.address.length > 0, "dns.lookup localhost: " + JSON.stringify(res));
    const ext = await withTimeout(10000, () => lookup("example.com"));
    assert(/^\d+\.\d+\.\d+\.\d+$/.test(ext.address) || ext.address.includes(":"),
      "dns.lookup de un dominio externo: " + JSON.stringify(ext));
    const all = await withTimeout(10000, () => dns.promises.lookup("example.com", { all: true }));
    assert(Array.isArray(all) && all.length > 0, "dns.lookup all: " + JSON.stringify(all));
  },

  node_dns_raw_resolve: async () => {
    // c-ares no tiene /etc/resolv.conf en Termux y el proceso NUNCA resuelve ni
    // rechaza, ni siquiera con server explicito. Miden esto igual bun 1.3.14 de
    // $PREFIX/bin (upstream) => limitacion de upstream sobre bionic, no del port.
    // Se espera que este caso falle por timeout: si empieza a pasar, la bateria
    // lo reporta como UNEXPECTED.
    await withTimeout(12000, () => dns.promises.resolve("example.com"));
    assert(false, "dns.promises.resolve devolvio algo: la limitacion upstream desaparecio");
  },

  node_crypto_deep: () => {
    eq(crypto.createHash("sha256").update("abc").digest("hex"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 vector conocido");
    eq(crypto.pbkdf2Sync("pw", crypto.randomBytes(16), 1000, 32, "sha256").length, 32, "pbkdf2Sync");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const sig = crypto.sign("sha256", Buffer.from("mensaje"), privateKey);
    assert(crypto.verify("sha256", Buffer.from("mensaje"), publicKey, sig), "ECDSA sign/verify");
    assert(crypto.timingSafeEqual(Buffer.from("aa"), Buffer.from("aa")), "timingSafeEqual");
    const iv = crypto.randomBytes(16), key = crypto.randomBytes(32);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    const enc = Buffer.concat([cipher.update("datos secrets"), cipher.final()]);
    const dec = crypto.createDecipheriv("aes-256-cbc", key, iv);
    eq(Buffer.concat([dec.update(enc), dec.final()]).toString(), "datos secrets", "aes-256-cbc ronda");
    assert(crypto.getHashes().includes("sha512"), "getHashes incluye sha512");
    eq(crypto.hkdfSync("sha256", Buffer.alloc(32), Buffer.alloc(16), Buffer.alloc(8), 42).byteLength, 42, "hkdfSync");
  },

  util_and_events_extras: async () => {
    eq(util.inspect({ a: [1, 2] }, { depth: 1 }), "{ a: [ 1, 2 ] }", "util.inspect baseline");
    assert(util.types.isNativeError(new Error("x")), "util.types.isNativeError");
    const ee = new EventEmitter();
    setTimeout(() => ee.emit("ping", 7), 50);
    const [val] = await once(ee, "ping");
    eq(val, 7, "events.once");
    const ac = new AbortController();
    const q = evOn(ee, "pong", { signal: ac.signal });
    ac.abort();
    let threw = false;
    try { for await (const _ of q) { void _; } } catch { threw = true; }
    assert(threw, "events.on con AbortController debe lanzar AbortError");
  },

  string_decoder_and_buffers: () => {
    const d = new StringDecoder("utf8");
    const bytes = Buffer.from("ñá", "utf8");
    let out = "";
    for (const b of bytes) out += d.write(Buffer.from([b]));
    eq(out, "ñá", "StringDecoder rearma UTF-8 byte a byte");
    eq(Buffer.concat([Buffer.from("a"), Buffer.from("b")]).toString(), "ab", "Buffer.concat");
    eq(Buffer.from("ÿ", "latin1").toString("hex"), "ff", "latin1 -> hex");
    eq(new TextDecoder().decode(Buffer.from("42", "hex")), "B", "TextDecoder");
  },

  process_signals_handler: async () => {
    const script = P("sig-probe.mjs");
    writeFileSync(script,
      'process.on("SIGUSR1", () => { console.log("handled-sigusr1"); process.exit(0); });\n' +
      'console.log("ready");\nawait Bun.sleep(20000);\n');
    const proc = Bun.spawn({ cmd: [process.execPath, "run", script], stdout: "pipe", stderr: "pipe" });
    const reader = proc.stdout.getReader();
    const { value } = await withTimeout(10000, () => reader.read());
    assert(new TextDecoder().decode(value ?? "").includes("ready"), "stdout del hijo listo");
    proc.kill("SIGUSR1");
    const code = await withTimeout(10000, () => proc.exited);
    eq(code, 0, "el handler de SIGUSR1 debe correr y exitar 0");
  },

  // --- agregados A2 (sonda de paridad: identico en bun oficial linux-x64 1.4.2) ---
  node_net_tcp_echo: async () => {
    const net = await import("node:net");
    const srv = net.createServer((sk) => sk.on("data", (b) => sk.write("eco:" + b)));
    await withTimeout(8000, () => new Promise((res, rej) => {
      srv.listen(0, "127.0.0.1", res); srv.on("error", rej);
    }));
    const port = srv.address().port;
    try {
      const got = await withTimeout(10000, () => new Promise((res, rej) => {
        const c = net.connect(port, "127.0.0.1", () => c.write("hola"));
        c.once("data", (b) => { res(b.toString()); c.end(); });
        c.once("error", (e) => rej(new Error("client: " + e.message)));
      }));
      eq(got, "eco:hola", "echo TCP por node:net");
    } finally { srv.close(); }
  },

  node_dgram_udp_echo: async () => {
    const dgram = await import("node:dgram");
    const srv = dgram.createSocket("udp4");
    srv.on("message", (msg, ri) => srv.send(Buffer.from("udp:" + msg), ri.port, ri.address));
    await withTimeout(8000, () => new Promise((res, rej) => {
      srv.bind(0, "127.0.0.1", res); srv.on("error", rej);
    }));
    const port = srv.address().port;
    try {
      const cli = dgram.createSocket("udp4");
      const got = await withTimeout(10000, () => new Promise((res, rej) => {
        cli.once("message", (m) => res(m.toString()));
        cli.once("error", (e) => rej(new Error("cli: " + e.message)));
        cli.send(Buffer.from("ping"), port, "127.0.0.1");
      }));
      cli.close();
      eq(got, "udp:ping", "datagrama UDP ida y vuelta");
    } finally { srv.close(); }
  },

  node_tls_server_and_client: async () => {
    // Cert efimero del propio caso (ver lib.mjs selfSignedCert): la verificacion
    // se ejercita fijando ESTA ca, no desactivandola.
    const { key, cert } = selfSignedCert();
    const tls = await import("node:tls");
    const { readFileSync: rd } = await import("node:fs");
    const srv = tls.createServer({ key: rd(key), cert: rd(cert) },
      (sk) => sk.on("data", (b) => sk.write("tls:" + b)));
    await withTimeout(8000, () => new Promise((res, rej) => {
      srv.listen(0, "127.0.0.1", res); srv.on("error", rej);
    }));
    const port = srv.address().port;
    try {
      const got = await withTimeout(15000, () => new Promise((res, rej) => {
        const c = tls.connect({ host: "127.0.0.1", port, ca: rd(cert, "utf8"),
          servername: "localhost" }, () => c.write("hola"));
        c.once("data", (b) => { res(b.toString()); c.end(); });
        c.once("error", (e) => rej(new Error("handshake: " + e.message)));
      }));
      eq(got, "tls:hola", "handshake TLS con la CA del caso fijada");
    } finally { srv.close(); }
  },

  worker_sharedarraybuffer_atomics: async () => {
    const wsrc = P("worker-sab.mjs");
    writeFileSync(wsrc, "import { parentPort } from 'node:worker_threads';\n" +
      "parentPort.on('message', (sab) => { const v = new Int32Array(sab);\n" +
      "Atomics.wait(v, 0, 0, 5000); parentPort.postMessage(String(Atomics.load(v, 0))); });\n");
    const sab = new SharedArrayBuffer(16);
    const v = new Int32Array(sab);
    const w = new Worker(wsrc);
    try {
      const got = await withTimeout(15000, () => new Promise((res, rej) => {
        w.once("message", (m) => res(String(m)));
        w.once("error", (e) => rej(new Error("worker: " + e.message)));
        w.postMessage(sab);
        setTimeout(() => { Atomics.store(v, 0, 77); Atomics.notify(v, 0); }, 150);
      }));
      eq(got, "77", "Atomics.notify despierta el wait del worker");
    } finally { await w.terminate(); }
  },

  broadcast_channel_main_y_worker: async () => {
    // El worker tiene que registrar su listener ANTES de que el main postee:
    // sin esa sincronia el mensaje se pierde (medido: sin "listo" el caso cuelga).
    const wsrc = P("worker-bc.mjs");
    writeFileSync(wsrc, "import { parentPort } from 'node:worker_threads';\n" +
      "const bc = new BroadcastChannel('bateria-bc');\n" +
      "bc.addEventListener('message', (e) => bc.postMessage('eco:' + e.data));\n" +
      "parentPort.postMessage('listo');\n");
    const w = new Worker(wsrc);
    const bc = new BroadcastChannel("bateria-bc");
    try {
      const got = await withTimeout(15000, () => new Promise((res, rej) => {
        w.once("message", (m) => { if (m === "listo") bc.postMessage("hola-bc"); });
        w.once("error", (e) => rej(new Error("worker: " + e.message)));
        bc.addEventListener("message", (e) => res(e.data));
      }));
      eq(got, "eco:hola-bc", "BroadcastChannel cruza main <-> worker");
    } finally { bc.close(); await w.terminate(); }
  },

  module_create_require_rutas: async () => {
    const { createRequire } = await import("node:module");
    writeFileSync(P("lib-a2.cjs"), "module.exports = { tag: 'cjs-a2' };\n");
    const req = createRequire(path.join(CASE_DIR, "main.mjs"));
    const m = req(P("lib-a2.cjs"));
    eq(m.tag, "cjs-a2", "createRequire con ruta absoluta resuelve CJS");
    let fallo = null;
    try { req(P("no-existe.cjs")); } catch (e) { fallo = e.code; }
    eq(fallo, "MODULE_NOT_FOUND", "modulo ausente da MODULE_NOT_FOUND, no crash");
  },

  readline_interfaz_sobre_stdin: () => {
    const p = Bun.spawnSync({
      cmd: [process.execPath, "-e",
        'const rl = require("node:readline").createInterface({ input: process.stdin });\n' +
        "let n = 0; rl.on(\"line\", (l) => { n++; if (l === \"FIN\") { console.log(\"lineas=\" + n); rl.close(); } });\n"],
      cwd: CASE_DIR, stdout: "pipe", stderr: "pipe",
      stdin: new TextEncoder().encode("uno\ndos ñ\nFIN\n"),
    });
    eq(p.exitCode, 0, "rc del hijo con readline: " + p.stderr.toString().slice(0, 200));
    eq(p.stdout.toString().trim(), "lineas=3", "readline emitio cada linea");
  },

  fs_cp_recursive_y_readdir_recursive: () => {
    const base = P("arbol-a2"), dst = P("arbol-a2-copia");
    mkdirSync(path.join(base, "a/b"), { recursive: true });
    writeFileSync(path.join(base, "a/b/hondo.txt"), "hondo");
    writeFileSync(path.join(base, "a/orig.txt"), "orig");
    try { unlinkSync(path.join(base, "a/enlace.txt")); } catch {}
    symlinkSync("orig.txt", path.join(base, "a/enlace.txt"));
    cpSync(base, dst, { recursive: true });
    const names = readdirSync(dst, { recursive: true, encoding: "utf8" }).map(String);
    assert(names.some((n) => n.replace(/\\/g, "/").endsWith("b/hondo.txt")),
      "readdir recursive ve el fondo: " + names.slice(0, 5).join(","));
    eq(readFileSync(path.join(dst, "a/enlace.txt"), "utf8"), "orig", "el symlink se resuelve tras cp");
    rmSync(base, { recursive: true, force: true });
    rmSync(dst, { recursive: true, force: true });
  },

  zlib_gzip_stream_a_archivo: async () => {
    const zlib = await import("node:zlib");
    const { Readable, pipeline, Transform } = await import("node:stream");
    const src = "ñ".repeat(200000);
    const gz = P("a2.gz");
    await withTimeout(20000, () => new Promise((res, rej) => {
      pipeline(Readable.from([Buffer.from(src, "utf8")]), zlib.createGzip(),
        createWriteStream(gz), (e) => (e ? rej(new Error("pipeline: " + e.message)) : res()));
    }));
    const n = statSync(gz).size;
    assert(n > 0 && n < 20000, "gzip comprimi de verdad: " + n + "B");
    const back = zlib.gunzipSync(readFileSync(gz)).toString("utf8");
    eq(back.length, src.length, "ida y vuelta por stream conserva el largo UTF-8");
    const a = new Transform({ transform(c, _, cb) { cb(null, Buffer.from("X" + c)); } });
    const chunks = [];
    await withTimeout(10000, () => new Promise((res, rej) => {
      a.on("data", (c) => chunks.push(c)); a.on("end", res); a.on("error", rej);
      a.end(Buffer.from("abc"));
    }));
    eq(Buffer.concat(chunks).toString(), "Xabc", "Transform custom por stream");
  },
};

export default caseMain(cases);
