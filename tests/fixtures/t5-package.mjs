// T5 · el gestor de paquetes y el bundler en Termux: installs reales con red,
// lockfile, scripts de package.json (donde vive el gap del shim `node`), y
// `bun build`. Todo el scratch queda en BATTERY_CASE_DIR y lo borra el runner.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { assert, caseMain, CASE_DIR, eq, runBin, self, skip, withTimeout } from "./lib.mjs";

const P = (...p) => path.join(CASE_DIR, ...p);

function networkSkip(p) {
  const err = (p.stderr?.toString?.() ?? "") + (p.stdout?.toString?.() ?? "");
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network|CouldNotResolve|TimedOut|dns/i.test(err)) {
    skip("sin acceso al registry desde este dispositivo: " + err.split("\n").filter(Boolean).slice(-1)[0]);
  }
}

const cases = {
  install_direct_dep: () => {
    writeFileSync(P("package.json"), JSON.stringify({
      name: "battery-install", dependencies: { ms: "2.1.3" },
    }, null, 2));
    const p = self(["install"]);
    networkSkip(p);
    eq(p.exitCode, 0, "bun install rc: " + p.stderr.toString().slice(-400));
    assert(existsSync(P("node_modules/ms/index.js")), "node_modules/ms materializado");
    const use = self(["-e", 'const ms=require("ms");console.log(ms(1000)+"/"+ms(60000)+"/"+ms(90000))']);
    // ms(90000) redondea a "2m": verificado identico en el oraculo 1.3.14.
    eq(use.stdout.toString().trim(), "1s/1m/2m", "el paquete instalado se resuelve y ejecuta");
  },

  install_transitive_deps: () => {
    writeFileSync(P("package.json"), JSON.stringify({
      name: "battery-transitive", dependencies: { debug: "4.3.7" },
    }, null, 2));
    const p = self(["install"]);
    networkSkip(p);
    eq(p.exitCode, 0, "bun install (debug) rc: " + p.stderr.toString().slice(-400));
    assert(existsSync(P("node_modules/debug") && P("node_modules/ms")), "debug y su dep ms instalados");
    const use = self(["-e", 'const d=require("debug");d("bat")("x");console.log(typeof d)']);
    eq(use.stdout.toString().trim(), "function", "modulo con deps transitivas cargable");
  },

  install_writes_and_honours_lockfile: () => {
    writeFileSync(P("package.json"), JSON.stringify({
      name: "battery-lock", dependencies: { ms: "2.1.3" },
    }, null, 2));
    const first = self(["install"]);
    networkSkip(first);
    eq(first.exitCode, 0, "install inicial rc");
    assert(existsSync(P("bun.lock")) || existsSync(P("bun.lockb")), "debe quedar un lockfile (bun.lock o bun.lockb)");
    const lockPath = existsSync(P("bun.lock")) ? P("bun.lock") : P("bun.lockb");
    const lock1 = readFileSync(lockPath);
    const again = self(["install", "--frozen-lockfile"]);
    eq(again.exitCode, 0, "--frozen-lockfile rc: " + again.stderr.toString().slice(-400));
    eq(readFileSync(lockPath).toString("hex"), lock1.toString("hex"), "el lockfile no cambia en un install idéntico");
  },

  install_removes_pruned_dep: () => {
    writeFileSync(P("package.json"), JSON.stringify({
      name: "battery-prune", dependencies: { ms: "2.1.3", debug: "4.3.7" },
    }, null, 2));
    const a = self(["install"]);
    networkSkip(a);
    eq(a.exitCode, 0, "install con 2 deps rc");
    writeFileSync(P("package.json"), JSON.stringify({
      name: "battery-prune", dependencies: { ms: "2.1.3" },
    }, null, 2));
    const b = self(["install"]);
    eq(b.exitCode, 0, "re-install tras podar rc: " + b.stderr.toString().slice(-400));
    // El contrato que SISe cumple: el lockfile ya no referencia la dep.
    const lockPath = existsSync(P("bun.lock")) ? P("bun.lock") : P("bun.lockb");
    const lock = readFileSync(lockPath, "utf8");
    assert(!lock.includes("debug"), "el lockfile debe quitar la dep podada");
    // Y esto es lo que Bun NO hace (idéntico en el oraculo 1.3.14, ver
    // docs/KNOWN-ISSUES.md): borra el paquete del grafo pero deja el directorio
    // materializado y todavia resoluble.
    assert(!existsSync(P("node_modules/debug")), "la dep podada desaparece de node_modules");
  },

  run_script_node_shim: () => {
    // `bun run <script>` inyecta un shim `node` -> bun en BUN_NODE_DIR. En
    // Termux el candidato historico era /data/local/tmp (no escribible): este
    // caso mide que directorio usa realmente el build android.
    //
    // El PATH se reduce a un directorio VACIO propio: asi el unico `node`
    // posible es el shim que bun inyecta. Con $PREFIX/bin en el PATH habria
    // pasado igual pero por el node real de Termux (falso verde).
    mkdirSync(P("emptybin"), { recursive: true });
    writeFileSync(P("package.json"), JSON.stringify({
      name: "battery-shim",
      scripts: { probe: 'node -e "console.log(\'respondio:\' + (process.versions.bun ? \'shim-bun\' : \'node-real\'))"' },
    }, null, 2));
    const p = self(["run", "probe"], { env: { PATH: P("emptybin"), HOME: process.env.HOME } });
    const out = p.stdout.toString();
    const err = p.stderr.toString();
    if (p.exitCode !== 0) {
      throw new Error(`bun run sin node en PATH fallo (rc=${p.exitCode} signal=${p.signalCode ?? "-"}): ` +
        (err || out).split("\n").filter(Boolean).slice(0, 4).join(" | "));
    }
    assert(out.includes("respondio:shim-bun"), "quien respondio a `node`: " + out.trim() + " // " + err.slice(0, 200));
  },

  bunx_runs_package_bin: () => {
    const p = self(["x", "cowsay@1.6.0", "hola"]);
    networkSkip(p);
    // `bun x` debe instalar y ejecutar el bin del paquete. La senal va en el
    // mensaje: exitCode null + signal dice como murio, rc a secas no alcanza.
    eq(p.exitCode, 0,
      `bun x cowsay rc (signal=${p.signalCode ?? "-"}): ` + p.stderr.toString().slice(-400));
    assert(p.stdout.toString().includes("hola"), "salida de cowsay con el texto: " + p.stdout.toString().slice(0, 120));
  },

  build_bun_target_and_run: () => {
    writeFileSync(P("src-a.ts"), "export const greet = (who: string): string => `hola ${who}`;\n");
    writeFileSync(P("src-main.ts"), 'import { greet } from "./src-a";\nconsole.log(greet("build"));\n');
    const b = self(["build", "src-main.ts", "--target=bun", "--outfile", "dist-bun.js"]);
    eq(b.exitCode, 0, "bun build rc: " + b.stderr.toString().slice(-400));
    assert(existsSync(P("dist-bun.js")), "outfile generado");
    const r = self(["run", "dist-bun.js"]);
    eq(r.stdout.toString().trim(), "hola build", "el bundle corre");
  },

  build_node_target_output_is_js: () => {
    writeFileSync(P("n-main.mjs"), "import fs from 'node:fs';\nconsole.log(typeof fs.readFileSync);\n");
    const b = self(["build", "n-main.mjs", "--target=node", "--outfile", "dist-node.js"]);
    eq(b.exitCode, 0, "bun build --target=node rc: " + b.stderr.toString().slice(-400));
    const txt = readFileSync(P("dist-node.js"), "utf8");
    assert(txt.length > 0, "bundle no vacio");
    const r = self(["run", "dist-node.js"]);
    eq(r.exitCode, 0, "el bundle node-target corre con bun: " + r.stderr.toString().slice(-300));
  },

  build_minify_smaller_and_correct: () => {
    const src = Array.from({ length: 400 }, (_, i) => `export const v${i} = ${i} * 2; // comentario largo`).join("\n");
    writeFileSync(P("m-src.js"), src + "\nconsole.log(v399);\n");
    const plain = self(["build", "m-src.js", "--target=bun", "--outfile", "m-plain.js"]);
    eq(plain.exitCode, 0, "build plain rc");
    const min = self(["build", "m-src.js", "--target=bun", "--minify", "--outfile", "m-min.js"]);
    eq(min.exitCode, 0, "build minify rc: " + min.stderr.toString().slice(-300));
    assert(statSync(P("m-min.js")).size < statSync(P("m-plain.js")).size, "minify debe achicar el bundle");
    const r = self(["run", "m-min.js"]);
    eq(r.stdout.toString().trim(), "798", "el bundle minificado conserva la semantica");
  },

  install_then_compile_from_node_modules: () => {
    writeFileSync(P("package.json"), JSON.stringify({ name: "battery-c", dependencies: { ms: "2.1.3" } }, null, 2));
    const i = self(["install"]);
    networkSkip(i);
    eq(i.exitCode, 0, "install rc");
    writeFileSync(P("app.mjs"), 'import ms from "ms";\nconsole.log("dep " + ms(1000));\n');
    const b = self(["build", "--compile", "app.mjs", "--outfile", "probe-c"]);
    eq(b.exitCode, 0, "--compile con node_modules rc: " + b.stderr.toString().slice(-300));
    const r = runBin(P("probe-c"));
    eq(r.exitCode, 0, "standalone con dep corre: " + r.stderr.toString().slice(-300));
    eq(r.stdout.toString().trim(), "dep 1s", "dep empaquetada en standalone");
  },
};

export default caseMain(cases);
