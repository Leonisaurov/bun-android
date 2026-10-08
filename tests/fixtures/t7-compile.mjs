// T7 · `bun build --compile` en android/bionic. Mide la sonda ya documentada
// (docs/STANDALONE.md) SIN dejar los ~291 MB de ELF en el dispositivo: cada
// caso se borra a si mismo y hay un guard de espacio libre antes de compilar.
import { existsSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assert, caseMain, CASE_DIR, eq, runBin, self, skip } from "./lib.mjs";

const P = (...p) => path.join(CASE_DIR, ...p);
const OUT_MB_LIMIT = 500;

function requireSpace(mb) {
  const p = Bun.spawnSync({ cmd: ["df", "-k", "/data/data/com.termux/files/usr"], stdout: "pipe", stderr: "pipe" });
  eq(p.exitCode, 0, "df disponible");
  const line = p.stdout.toString().split("\n")[1];
  const availMb = Number(line.split(/\s+/)[3]) / 1024;
  if (availMb < mb) skip(`faltan ${mb} MB libres para --compile (hay ${Math.round(availMb)})`);
  return availMb;
}

function rm(file) {
  if (existsSync(file)) { try { unlinkSync(file); } catch {} }
}

const cases = {
  compile_hello_and_run: () => {
    requireSpace(1400);
    writeFileSync(P("app.mjs"), 'console.log("probe " + (20 + 22));\n');
    const out = P("probe-a");
    try {
      const b = self(["build", "--compile", "./app.mjs", "--outfile", "probe-a"]);
      eq(b.exitCode, 0, "--compile rc: " + b.stderr.toString().slice(-500));
      assert(existsSync(out), "el standalone se escribio");
      const sizeMb = statSync(out).size / 1024 / 1024;
      assert(sizeMb < OUT_MB_LIMIT, `standalone inflado por encima del limite medido: ${sizeMb.toFixed(0)} MB`);
      const r = runBin(out);
      eq(r.exitCode, 0, "el standalone corre: " + r.stderr.toString().slice(-300));
      eq(r.stdout.toString().trim(), "probe 42", "salida del standalone");
    } finally {
      rm(out);
    }
  },

  compile_args_and_env: () => {
    requireSpace(1400);
    writeFileSync(P("args.mjs"), 'console.log(process.argv.slice(2).join("|") + "/" + (process.env.PROBE_ENV ?? "unset"));\n');
    const out = P("probe-b");
    try {
      const b = self(["build", "--compile", "./args.mjs", "--outfile", "probe-b"]);
      eq(b.exitCode, 0, "--compile args rc");
      const r = runBin(out, ["uno", "ñ dos"], { env: { ...process.env, PROBE_ENV: "presente" } });
      eq(r.exitCode, 0, "standalone con argv rc");
      eq(r.stdout.toString().trim(), "uno|ñ dos/presente", "argv y env llegan al standalone");
    } finally {
      rm(out);
    }
  },

  compile_relative_import_and_cwd: () => {
    requireSpace(1400);
    writeFileSync(P("libx.mjs"), 'export const tag = "libx";\n');
    writeFileSync(P("main.mjs"),
      'import { tag } from "./libx.mjs";\n' +
      "import { cwd } from \"node:process\";\n" +
      "console.log(tag + \"@\" + (cwd().length > 0));\n");
    const out = P("probe-c");
    try {
      const b = self(["build", "--compile", "./main.mjs", "--outfile", "probe-c"]);
      eq(b.exitCode, 0, "--compile import relativo rc: " + b.stderr.toString().slice(-400));
      const r = runBin(out);
      eq(r.exitCode, 0, "standalone con import relativo corre: " + r.stderr.toString().slice(-400));
      assert(r.stdout.toString().includes("libx"), "el modulo empaquetado responde");
    } finally {
      rm(out);
    }
  },

  compile_is_reproducible_in_size: () => {
    requireSpace(2600);
    writeFileSync(P("two.mjs"), 'console.log(1 + 1);\n');
    const a = P("probe-d1"), b2 = P("probe-d2");
    try {
      const c1 = self(["build", "--compile", "./two.mjs", "--outfile", "probe-d1"]);
      const c2 = self(["build", "--compile", "./two.mjs", "--outfile", "probe-d2"]);
      eq(c1.exitCode, 0, "compile 1 rc");
      eq(c2.exitCode, 0, "compile 2 rc");
      const s1 = statSync(a).size, s2 = statSync(b2).size;
      eq(s1, s2, "dos compilaciones del mismo fuente pesan igual (determinismo de tamano)");
    } finally {
      rm(a); rm(b2);
    }
  },
};

export default caseMain(cases);
