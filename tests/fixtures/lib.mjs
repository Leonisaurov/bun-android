// Shared harness for the on-device battery (scripts/battery-device.sh).
//
// Protocol: the runner spawns `bun <tier-file> <case-name>` in a private
// directory (BATTERY_CASE_DIR). A case returns normally to PASS, throws to
// FAIL, or calls skip() to report "#SKIP <reason>" and exit 0.
import { existsSync } from "node:fs";
import path from "node:path";

export const CASE_DIR = process.env.BATTERY_CASE_DIR || process.cwd();

export function skip(reason) {
  console.log("#SKIP " + reason);
  process.exit(0);
}

export function assert(cond, msg) {
  if (!cond) throw new Error("assert: " + msg);
}

export function eq(got, want, msg) {
  if (got !== want) {
    // eq es de identidad: dos arrays/objetos con el mismo contenido SIEMPRE
    // fallan aqui. Si el JSON coincide, el mensaje lo dice, porque el par
    // "got X want X" sin pista cuesta media hora de triage.
    const g = JSON.stringify(got), w = JSON.stringify(want);
    const hint = g === w ? " (mismo JSON, distinta identidad: arrays/objetos van con eqJSON)" : "";
    throw new Error(`${msg}: got ${g} want ${w}${hint}`);
  }
}

// Structural comparison for the values `eq` cannot express (arrays, objects).
// Key order matters: pass literals already in the shape you expect.
export function eqJSON(got, want, msg) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error(`${msg}: got ${g} want ${w}`);
}

// Spawn the SAME binary under test, so CLI-level behaviour is measured, not
// assumed. env defaults to a clean Termux-ish env: pass `env` to override.
export function self(args, opts = {}) {
  return Bun.spawnSync({
    cmd: [process.execPath, ...args],
    cwd: CASE_DIR,
    stdout: "pipe",
    stderr: "pipe",
    ...opts,
  });
}

export async function selfAsync(args, opts = {}) {
  const p = Bun.spawn({
    cmd: [process.execPath, ...args],
    cwd: CASE_DIR,
    stdout: "pipe",
    stderr: "pipe",
    ...opts,
  });
  return {
    exitCode: await p.exited,
    stdout: await new Response(p.stdout).text(),
    stderr: await new Response(p.stderr).text(),
    pid: p.pid,
    kill: (sig) => p.kill(sig),
  };
}

// Un ELF standalone ya compilado se ejecuta DIRECTAMENTE: pasarle el camino
// como argumento a `bun` lo interpreta como fuente JS y falla con
// "Unexpected \x7f" (el magic de ELF), no un bug del binario.
export function runBin(bin, args = [], opts = {}) {
  return Bun.spawnSync({
    cmd: [bin, ...args],
    cwd: CASE_DIR,
    stdout: "pipe",
    stderr: "pipe",
    ...opts,
  });
}

// A child that dies from a signal reports exitCode === null and signalCode.
export function diedFrom(proc, name) {
  return proc.exitCode === null && proc.signalCode === name;
}

export function requirePath(p, why) {
  if (!existsSync(p)) skip(`${why}: no existe ${p}`);
}

// Cert efimero autofirmado para handshakes TLS LOCALES del propio caso (cada
// caso tiene su dir de scratch, asi que no se comparte entre casos). La
// verificacion se ejercita FIJANDO esta CA como trusted, nunca desactivandola;
// no sirve para trafico real.
export function selfSignedCert(dir = CASE_DIR) {
  const openssl = "/data/data/com.termux/files/usr/bin/openssl";
  if (!existsSync(openssl)) skip("openssl no instalado (necesario para el caso TLS)");
  const key = path.join(dir, "tls-key.pem");
  const cert = path.join(dir, "tls-cert.pem");
  const r = Bun.spawnSync({
    cmd: [openssl, "req", "-x509", "-newkey", "rsa:2048", "-keyout", key, "-out", cert,
      "-days", "1", "-nodes", "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
    cwd: dir, stdout: "pipe", stderr: "pipe",
  });
  if (!existsSync(cert) || !existsSync(key)) {
    skip(`openssl no genero el par key/cert (rc=${r.exitCode})`);
  }
  return { key, cert };
}

export function withTimeout(ms, fn) {
  return Promise.race([
    fn(),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

export async function caseMain(cases) {
  const name = process.argv[2];
  const fn = cases[name];
  if (!fn) {
    console.error(`case "${name}" no existe en este archivo (tal vez el manifiesto esta mal)`);
    process.exit(99);
  }
  try {
    await fn();
    console.log("ok " + name);
    process.exit(0);
  } catch (e) {
    console.error("FAIL " + name + ": " + (e && e.message ? e.message : String(e)));
    if (e && e.stack) console.error(String(e.stack).split("\n").slice(0, 6).join("\n"));
    process.exit(1);
  }
}
