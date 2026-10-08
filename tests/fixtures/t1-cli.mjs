// T1 · CLI surface: flags, exit codes, stdin, signals, transpile-on-run.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, caseMain, CASE_DIR, eq, self, selfAsync } from "./lib.mjs";

const cases = {
  version_flag: () => {
    const p = self(["--version"]);
    eq(p.exitCode, 0, "--version rc");
    assert(/^\d+\.\d+\.\d+/.test(p.stdout.toString().trim()), "--version formato: " + p.stdout.toString());
  },

  revision_flag: () => {
    const p = self(["--revision"]);
    eq(p.exitCode, 0, "--revision rc");
    const rev = p.stdout.toString().trim();
    assert(/\d+\.\d+\.\d+/.test(rev), "--revision formato: " + rev);
  },

  eval_print: () => {
    const p = self(["-e", "console.log(6*7)"]);
    eq(p.exitCode, 0, "-e rc");
    eq(p.stdout.toString().trim(), "42", "-e salida");
  },

  eval_async_tla: () => {
    const p = self(["-e", "const r = 1 + await Promise.resolve(41); console.log(r)"]);
    eq(p.exitCode, 0, "-e TLA rc: " + p.stderr.toString());
    eq(p.stdout.toString().trim(), "42", "-e TLA salida");
  },

  exit_code_passthrough: () => {
    for (const code of [0, 1, 7, 42]) {
      const p = self(["-e", `process.exit(${code})`]);
      eq(p.exitCode, code, `process.exit(${code})`);
    }
  },

  throw_exit_code: () => {
    const p = self(["-e", 'throw new Error("battery-boom")']);
    assert(p.exitCode !== 0, "un throw no puede exitar 0");
    assert(p.stderr.toString().includes("battery-boom"), "el mensaje del throw debe salir en stderr");
  },

  syntax_error_reported: () => {
    writeFileSync(join(CASE_DIR, "broken.ts"), "const = ;\n");
    const p = self(["run", "broken.ts"]);
    assert(p.exitCode !== 0, "sintaxis rota debe fallar");
    assert(p.stderr.toString().length > 0, "sintaxis rota debe explicar algo en stderr");
  },

  missing_file_error: () => {
    const p = self(["run", "./no-existe-9f3a2b.mjs"]);
    assert(p.exitCode !== 0, "archivo inexistente debe fallar");
    const err = p.stderr.toString().toLowerCase();
    assert(err.includes("enoent") || err.includes("not found") || err.includes("does not exist"),
      "error de archivo inexistente legible: " + p.stderr.toString().slice(0, 200));
  },

  stdin_pipe: async () => {
    const p = await selfAsync(["-e", 'const s = await Bun.stdin.text(); console.log("got:" + s.trim())'], {
      stdin: new TextEncoder().encode("hola-bateria\n"),
    });
    eq(p.exitCode, 0, "stdin rc: " + p.stderr);
    eq(p.stdout.trim(), "got:hola-bateria", "ronda por stdin");
  },

  argv_utf8_and_spaces: () => {
    // Con `bun -e` el argumento siguiente cae en argv[1] (semantica de upstream,
    // igual en 1.3.14), asi que argv se mide corriendo un archivo.
    writeFileSync(join(CASE_DIR, "argv-dump.mjs"), 'console.log(process.argv.slice(2).join("|"));\n');
    const p = self(["run", "argv-dump.mjs", "ñá 世界", "con espacio", "--flag"]);
    eq(p.exitCode, 0, "argv rc: " + p.stderr.toString());
    eq(p.stdout.toString().trim(), "ñá 世界|con espacio|--flag", "argv con UTF-8, espacios y --flag");
  },

  sigterm_to_child: async () => {
    writeFileSync(join(CASE_DIR, "sleeper.mjs"), 'await Bun.sleep(30000); console.log("no deberia llegar");\n');
    // Spawning directly: we need the handle BEFORE the process finishes, or
    // the signal would arrive after a natural exit and prove nothing.
    const proc = Bun.spawn({
      cmd: [process.execPath, "run", "sleeper.mjs"],
      cwd: CASE_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });
    await new Promise((r) => setTimeout(r, 500));
    proc.kill("SIGTERM");
    const code = await Promise.race([
      proc.exited,
      new Promise((_, rej) => setTimeout(() => rej(new Error("el hijo sobrevivio 10s a SIGTERM")), 10000)),
    ]);
    assert(code !== 0, "SIGTERM no corto al proceso (salio 0)");
  },

  typescript_run: () => {
    writeFileSync(
      join(CASE_DIR, "ts-probe.ts"),
      'type Shape = { w: number; h: number };\n' +
      "const area = (s: Shape): number => s.w * s.h;\n" +
      'const deco = <T extends object>(x: T): T => x;\n' +
      "console.log(area({ w: 6, h: 7 }), JSON.stringify(deco({ ok: true })));\n",
    );
    const p = self(["run", "ts-probe.ts"]);
    eq(p.exitCode, 0, "ts rc: " + p.stderr.toString());
    eq(p.stdout.toString().trim(), '42 {"ok":true}', "transpile de TS con generic y type alias");
  },

  esm_and_cjs_interop: () => {
    writeFileSync(join(CASE_DIR, "mod-cjs.cjs"), "module.exports = { tag: 'cjs' };\n");
    writeFileSync(join(CASE_DIR, "mod-esm.mjs"), "export const tag = 'esm';\n");
    writeFileSync(
      join(CASE_DIR, "interop.mjs"),
      "import { tag as esmTag } from './mod-esm.mjs';\nimport { createRequire } from 'node:module';\n" +
      "const require = createRequire(import.meta.url);\nconst cjs = require('./mod-cjs.cjs');\n" +
      "console.log(esmTag + '+' + cjs.tag);\n",
    );
    const p = self(["run", "interop.mjs"]);
    eq(p.exitCode, 0, "interop rc: " + p.stderr.toString());
    eq(p.stdout.toString().trim(), "esm+cjs", "mezcla ESM/CJS en un mismo modulo");
  },

  package_json_type_module: () => {
    writeFileSync(join(CASE_DIR, "package.json"), JSON.stringify({ name: "probe", type: "module" }));
    writeFileSync(join(CASE_DIR, "entry.js"), "import { join } from 'node:path';\nconsole.log(join('/a','b'));\n");
    const p = self(["run", "entry.js"]);
    eq(p.exitCode, 0, "type:module rc: " + p.stderr.toString());
    eq(p.stdout.toString().trim(), "/a/b", '"type":"module" respeta import en .js');
  },

  env_inherited_and_isolated: () => {
    const p = self(["-e", 'console.log(process.env.BATTERY_PROBE || "unset")'], {
      env: { ...process.env, BATTERY_PROBE: "set-1234" },
    });
    eq(p.exitCode, 0, "env rc");
    eq(p.stdout.toString().trim(), "set-1234", "env heredado al hijo");
    const q = self(["-e", 'console.log(process.env.BATTERY_PROBE || "unset")'], { env: {} });
    eq(q.stdout.toString().trim(), "unset", "env: {} tiene que aislar");
  },

  stdout_to_file_and_pipe: () => {
    const p = self(["-e", 'for (let i = 0; i < 20000; i++) console.log("line" + i)']);
    eq(p.exitCode, 0, "volumen de stdout rc");
    const lines = p.stdout.toString().split("\n").filter(Boolean);
    eq(lines.length, 20000, "20k lineas por stdout");
    eq(lines[19999], "line19999", "sin truncado al final");
  },
};

export default caseMain(cases);
