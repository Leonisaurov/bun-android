// T8 · bordes de Termux/Bionic: seccomp y openat2 bajo estres real, filesystem
// del /data, limites de fds, senales, EPIPE, rutas largas y presion de heap.
import net from "node:net";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { assert, caseMain, CASE_DIR, eq, self, skip, withTimeout } from "./lib.mjs";

const P = (...p) => path.join(CASE_DIR, ...p);
const PREFIX = "/data/data/com.termux/files/usr";

const cases = {
  dir_route_tcp_stress_openat2: async () => {
    const pub = P("pub");
    mkdirSync(pub, { recursive: true });
    for (let i = 0; i < 40; i++) writeFileSync(path.join(pub, `f${i}.txt`), `contenido-${i}\n`);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      routes: { "/f/*": { dir: "./pub" } },
      fetch: () => new Response("fb", { status: 404 }),
    });
    try {
      const results = await withTimeout(25000, () => Promise.all(
        Array.from({ length: 40 }, (_, i) => fetch(`http://127.0.0.1:${server.port}/f/f${i}.txt`).then(async (r) => ({
          i, status: r.status, body: (await r.text()).trim(),
        }))),
      ));
      eq(results.filter((r) => r.status === 200).length, 40, "40 dir-route concurrentes por TCP (regresion 0001)");
      eq(results[17].body, "contenido-17", "contenido correcto bajo estres");
    } finally { server.stop(); }
  },

  filesystem_case_sensitivity_data: () => {
    const upper = P("Case.TXT"), lower = P("case.txt");
    writeFileSync(upper, "MAYUSCULAS");
    assert(existsSync(upper), "existe el nombre con mayusculas");
    if (existsSync(lower)) {
      // Un FS que plegaria mayusculas/minusculas (case-insensitive) mezclaria
      // dos rutas distintas: en /data de Termux esto debe ser sensible.
      assert(readFileSync(upper, "utf8") !== readFileSync(lower, "utf8") || upper === lower,
        "el directorio del caso es case-insensitive: rutas plegadas");
    }
    writeFileSync(lower, "minusculas");
    eq(readFileSync(upper, "utf8"), "MAYUSCULAS", "los dos nombres conviven independientes");
    eq(readFileSync(lower, "utf8"), "minusculas", "los dos nombres conviven independientes (2)");
  },

  deep_directories_120: () => {
    let d = P("deep");
    mkdirSync(d, { recursive: true });
    for (let i = 0; i < 120; i++) d = path.join(d, "nivel-ñ" + i);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "fondo.txt"), "llegue al fondo");
    eq(readFileSync(path.join(d, "fondo.txt"), "utf8"), "llegue al fondo", "ruta de 120 niveles legible");
    assert(readdirSync(d).includes("fondo.txt"), "readdir en el fondo");
  },

  rlimit_nofile_and_many_fds: () => {
    const limits = readFileSync("/proc/self/limits", "utf8");
    const line = limits.split("\n").find((l) => l.toLowerCase().includes("open files"));
    assert(line, "/proc/self/limits menciona open files: " + JSON.stringify(limits.slice(0, 200)));
    const soft = Number(line.match(/(\d+|unlimited)/i)[1]);
    const want = Number.isFinite(soft) && soft !== 1024 ? Math.min(soft - 40, 400) : 200;
    const fds = [];
    try {
      for (let i = 0; i < want; i++) fds.push(openSync(P(`fd-${i}.tmp`), "w"));
      eq(fds.length, want, `${want} descriptores abiertos a la vez`);
      const fdCount = readdirSync("/proc/self/fd").length;
      assert(fdCount >= want, "/proc/self/fd refleja los descriptores: " + fdCount);
    } finally {
      for (const fd of fds) { try { closeSync(fd); } catch {} }
    }
    for (let i = 0; i < want; i++) { try { unlinkSync(P(`fd-${i}.tmp`)); } catch {} }
  },

  fd_leak_after_repeated_open: () => {
    const base = readdirSync("/proc/self/fd").length;
    const f = P("leak.txt");
    writeFileSync(f, "dato");
    for (let i = 0; i < 800; i++) { const fd = openSync(f, "r"); closeSync(fd); }
    const after = readdirSync("/proc/self/fd").length;
    assert(after - base < 20, `fds fugados: base=${base} despues=${after}`);
  },

  spawn_flood_50: async () => {
    const ps = Array.from({ length: 50 }, (_, i) =>
      Bun.spawn({ cmd: [process.execPath, "-e", `console.log("h${i}")`], stdout: "pipe", stderr: "pipe" }));
    // stdout hay que drenarlo por stream: en un hijo async p.stdout es ReadableStream
    // y .bytes() devuelve una Promise sin await.
    const [codes, outs] = await withTimeout(60000, () => Promise.all([
      Promise.all(ps.map((p) => p.exited)),
      Promise.all(ps.map((p) => new Response(p.stdout).text())),
    ]));
    eq(codes.filter((c) => c === 0).length, 50, "50 spawns concurrentes exitan 0");
    eq(outs[49].trim(), "h49", "stdout correcto del ultimo spawn (sin cruzar pipes)");
    eq(new Set(outs.map((o) => o.trim())).size, 50, "cada hijo devolvio su propia linea");
  },

  env_var_100kb: () => {
    const big = "x".repeat(100 * 1024);
    const p = self(["-e", 'console.log((process.env.BIG?.length ?? 0) + "/" + (process.env.BIG === undefined ? "unset" : "set"))'], {
      env: { ...process.env, BIG: big },
    });
    eq(p.exitCode, 0, "env enorme rc: " + p.stderr.toString().slice(-200));
    eq(p.stdout.toString().trim(), `${big.length}/set`, "variable de 100 KB llega al hijo");
  },

  exec_shell_script_from_scratch: () => {
    const script = P("probe.sh");
    writeFileSync(script, "#!/system/bin/sh\necho sh-ok\n");
    chmodSync(script, 0o755);
    const p = Bun.spawnSync({ cmd: [script], stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) {
      const err = p.stderr.toString();
      if (/no exec|Permission denied|EACCES/i.test(err)) skip("$PREFIX/tmp montado noexec en este dispositivo: " + err.trim());
      throw new Error("script shell desde el scratch de Termux rc=" + p.exitCode + ": " + err.slice(0, 200));
    }
    eq(p.stdout.toString().trim(), "sh-ok", "ejecucion de un script sh en el scratch");
  },

  write_outside_allowed_paths_denied_not_crash: () => {
    const target = "/data/local/tmp/bun-android-probe.txt";
    let code = null;
    try { writeFileSync(target, "x"); } catch (e) { code = e.code; }
    if (code === null) {
      try { unlinkSync(target); } catch {}
      // No es un fallo: solo significa que este dispositivo deja escribir ahi.
      return;
    }
    assert(["EACCES", "EPERM", "ENOENT"].includes(code), `error esperado EACCES/EPERM/ENOENT, fue ${code}`);
  },

  sigpipe_does_not_kill_process: async () => {
    const sock = P("sigpipe.sock");
    const big = Buffer.alloc(2 * 1024 * 1024, 0x41);
    const srv = net.createServer((s) => {
      s.on("error", () => {});
      try { for (let i = 0; i < 8; i++) s.write(big); } catch {}
    });
    await new Promise((r) => srv.listen(sock, r));
    try {
      const client = net.connect(sock);
      client.on("connect", () => setImmediate(() => client.destroy()));
      client.on("error", () => {});
      await Bun.sleep(1200);
      assert(process.kill(process.pid, 0), "el proceso sigue vivo tras escribir en un socket cerrado");
    } finally {
      await new Promise((r) => srv.close(r));
    }
  },

  run_through_symlinked_executable: () => {
    const link = P("bun-via-link");
    try { symlinkSync(process.execPath, link); } catch (e) { skip("sin symlinks ahi: " + e.code); }
    const p = Bun.spawnSync({ cmd: [link, "-e", "console.log(process.execPath)"], stdout: "pipe", stderr: "pipe" });
    eq(p.exitCode, 0, "correr bun via symlink rc: " + p.stderr.toString().slice(-200));
    assert(p.stdout.toString().trim().length > 0, "execPath reportado por el symlink");
  },

  heap_stress_256mb: () => {
    const chunks = [];
    try {
      for (let i = 0; i < 64; i++) {
        const b = Buffer.alloc(4 * 1024 * 1024, i);
        b[0] = 0xff;
        chunks.push(b);
      }
      eq(chunks.length, 64, "256 MB de Buffers retenidos");
      eq(chunks[63][0], 0xff, "el primer byte del ultimo chunk es legible");
      eq(chunks[0].length, 4 * 1024 * 1024, "longitud intacta");
    } finally {
      chunks.length = 0;
    }
    const s = new Array(2_000_000).fill(1).reduce((a, b) => a + b, 0);
    eq(s, 2_000_000, "GC/heap con 2M de objetos JS");
  },

  cwd_with_utf8_and_spaces: () => {
    const d = P("una carpeta ñ 世界");
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "a.txt"), "1");
    const p = self(["-e", 'const {readFileSync}=require("fs");console.log(readFileSync("a.txt","utf8")+"@"+process.cwd())'], {
      cwd: d,
    });
    eq(p.exitCode, 0, "cwd con espacios rc: " + p.stderr.toString().slice(-200));
    assert(p.stdout.toString().startsWith("1@"), "lectura relativa al cwd raro");
    assert(p.stdout.toString().includes("ñ"), "process.cwd conserva el UTF-8: " + p.stdout.toString().trim());
  },

  os_tmpdir_matches_prefix_patch: () => {
    // Regresion amplia del patch 0004: con TMPDIR/TMP/TEMP ausentes el fallback
    // debe ser $PREFIX/tmp, no /data/local/tmp.
    const p = Bun.spawnSync({
      cmd: [process.execPath, "-e", 'console.log(require("node:os").tmpdir())'],
      stdout: "pipe", stderr: "pipe",
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !["TMPDIR", "TMP", "TEMP"].includes(k))),
    });
    eq(p.exitCode, 0, "tmpdir rc");
    eq(p.stdout.toString().trim(), path.join(PREFIX, "tmp"), "tmpdir() cae al prefijo de Termux");
    assert(os.tmpdir !== undefined, "node:os presente");
  },

  process_and_runtime_identity: () => {
    eq(process.platform, "android", "process.platform");
    eq(process.arch, "arm64", "process.arch");
    assert(/^\d+\.\d+\.\d+/.test(process.versions.bun), "process.versions.bun: " + process.versions.bun);
    assert(process.pid > 0, "pid");
    eq(Number(readFileSync("/proc/self/stat", "utf8").split(" ")[0]), process.pid,
      "/proc/self/stat coincide con process.pid");
    assert(existsSync("/proc/self/exe"), "/proc/self/exe existe");
    eq(readlinkSync("/proc/self/exe"), process.execPath, "/proc/self/exe apunta al ejecutable");
  },
};

export default caseMain(cases);
