// Shared harness for the on-device battery (scripts/battery-device.sh).
//
// Protocol: the runner spawns `bun <tier-file> <case-name>` in a private
// directory (BATTERY_CASE_DIR). A case returns normally to PASS, throws to
// FAIL, or calls skip() to report "#SKIP <reason>" and exit 0.
import { existsSync } from "node:fs";

export const CASE_DIR = process.env.BATTERY_CASE_DIR || process.cwd();

export function skip(reason) {
  console.log("#SKIP " + reason);
  process.exit(0);
}

export function assert(cond, msg) {
  if (!cond) throw new Error("assert: " + msg);
}

export function eq(got, want, msg) {
  if (got !== want) throw new Error(`${msg}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
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
