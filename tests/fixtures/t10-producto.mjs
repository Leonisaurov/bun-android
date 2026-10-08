// T10 · superficie de producto que la batería no tocaba: los helpers de `Bun`,
// los sockets unix sobre Bionic, `--watch`, `node:vm`, los atributos de import
// y los cuatro stubs medidos IDÉNTICOS en el oráculo 1.3.14 (van como KNOWN).
//
// Cada forma/assert de este archivo viene de una medición en el dispositivo
// (sondas a3-probe*.mjs en $PREFIX/tmp), no de la documentación: en 1.4.x
// varias firmas cambiaron respecto de lo que dice el README de upstream.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "bun:sqlite";
import { assert, caseMain, CASE_DIR, eq, eqJSON, withTimeout } from "./lib.mjs";

const P = (...p) => path.join(CASE_DIR, ...p);

// png 1x1 valido (el que usa la sonda de Image; lo escribimos para no depender
// de ningun asset del repo).
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");

const ZSTD_PAYLOAD = "zstd-medicion-".repeat(400);

const cases = {
  // `Bun.JSONL` NO exporta `stringify` (medido): solo parse/parseChunk, y este
  // ultimo devuelve {values, read, done, error}, no un array.
  serializers_toml_yaml_json5_jsonl: () => {
    const toml = Bun.TOML.stringify({ title: "x", n: 1, arr: [1, 2], sub: { a: true } });
    assert(toml.includes("title = \"x\""), "TOML usa `clave = valor`: " + toml);
    eq(JSON.stringify(Bun.TOML.parse(toml)), JSON.stringify({ title: "x", n: 1, arr: [1, 2], sub: { a: true } }), "TOML roundtrip");

    const yaml = Bun.YAML.stringify({ a: 1, b: ["x", "y"] });
    eq(JSON.stringify(Bun.YAML.parse(yaml)), JSON.stringify({ a: 1, b: ["x", "y"] }), "YAML roundtrip");

    eq(JSON.stringify(Bun.JSON5.parse("{ a: 1, /*c*/ b: 'x' }")), JSON.stringify({ a: 1, b: "x" }), "JSON5 con comentario y comillas simples");
    eq(JSON.stringify(Bun.JSONL.parse('{"a":1}\n{"a":2}')), JSON.stringify([{ a: 1 }, { a: 2 }]), "JSONL.parse sobre dos lineas");
    eq(typeof Bun.JSONL.stringify, "undefined", "JSONL no tiene stringify en 1.4.2");

    const chunk = Bun.JSONL.parseChunk(new TextEncoder().encode('{"a":1}\n{"b":'));
    eq(chunk.values.length, 1, "parseChunk rinde la linea completa");
    eq(chunk.done, false, "parseChunk avisa que quedo incompleto");
  },

  xml_stringify_y_parse: () => {
    const s = Bun.XML.stringify({ a: { b: "1" } });
    eq(s, "<a><b>1</b></a>", "XML.stringify emite el arbol");
    const back = Bun.XML.parse("<a><b>1</b></a>");
    eq(JSON.stringify(back), JSON.stringify({ a: { b: "1" } }), "XML.parse vuelve al objeto");
  },

  zstd_roundtrip_sync_y_async: async () => {
    const c = Bun.zstdCompressSync(ZSTD_PAYLOAD);
    const d = new TextDecoder().decode(Bun.zstdDecompressSync(c));
    eq(d, ZSTD_PAYLOAD, "zstd sync devuelve el payload exacto");
    assert(c.byteLength < ZSTD_PAYLOAD.length / 10, "el payload repetible comprime 10x: " + c.byteLength);
    const ca = await Bun.zstdCompress(ZSTD_PAYLOAD);
    eq(new TextDecoder().decode(await Bun.zstdDecompress(ca)), ZSTD_PAYLOAD, "zstd async roundtrip");
  },

  webcrypto_ecdsa_hkdf_y_export: async () => {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const msg = new TextEncoder().encode("msg");
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, msg);
    eq(sig.byteLength, 64, "la firma P-256 es de 64 bytes");
    eq(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey, sig, msg), true, "verify con la publica");
    const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
    eq(jwk.crv, "P-256", "jwk conserva la curva");

    const km = await crypto.subtle.importKey("raw", new TextEncoder().encode("ikm"), "HKDF", false, ["deriveBits"]);
    const params = { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("salt"), info: new TextEncoder().encode("info") };
    const a = new Uint8Array(await crypto.subtle.deriveBits(params, km, 256));
    const b = new Uint8Array(await crypto.subtle.deriveBits(params, km, 256));
    eq(a.length, 32, "HKDF deriva 32 bytes");
    eq(a.join(","), b.join(","), "HKDF es deterministico con los mismos params");
  },

  intl_collator_es_y_pluralrules: () => {
    const c = new Intl.Collator("es", { sensitivity: "base" });
    // Medido: en es la ñ es letra propia, entonces "ñoño" va DESPUES de "nono".
    eq(c.compare("ñoño", "nono"), 1, "collator es: ñ es letra distinta");
    const pr = new Intl.PluralRules("es-AR");
    eq(pr.select(1), "one", "es-AR tiene one");
    eq(pr.select(5), "other", "es-AR no tiene many");
  },

  semver_satisfies_y_order: () => {
    eq(Bun.semver.satisfies("1.4.2", "^1.0.0"), true, "satisfies con caret");
    eq(Bun.semver.satisfies("2.0.0", "^1.0.0"), false, "satisfies rechaza la major siguiente");
    eqJSON([Bun.semver.order("1.2.3", "1.2.4"), Bun.semver.order("1.2.4", "1.2.3"), Bun.semver.order("1.2.3", "1.2.3")], [-1, 1, 0], "order es -1/1/0");
  },

  deep_equals_y_match_direccion: () => {
    eq(Bun.deepEquals({ a: [1] }, { a: [1] }), true, "deepEquals estructura");
    // Medido: `deepMatch(pattern, actual)` — el PRIMER arg es el patron, y los
    // arrays no admiten subconjuntos (a diferencia de los objetos).
    eq(Bun.deepMatch({ a: 1 }, { a: 1, b: 2 }), true, "deepMatch: patron a la izquierda");
    eq(Bun.deepMatch({ a: 1, b: 2 }, { a: 1 }), false, "deepMatch no es simetrico");
    eq(Bun.deepMatch({ u: { id: 1 } }, { u: { id: 1, n: "x" } }), true, "deepMatch anidado");
    eq(Bun.deepMatch({ arr: [1] }, { arr: [1, 2] }), false, "deepMatch con array exijo igualdad");
  },

  ansi_helpers_sobre_codigos_reales: () => {
    const rojo = "\x1b[31mrojo\x1b[0m";
    eq(Bun.stringWidth(rojo), 4, "stringWidth ignora los escapes");
    eq(Bun.stripANSI(rojo), "rojo", "stripANSI deja el texto");
    eq(Bun.sliceAnsi(rojo, 0, 2), "\x1b[31mro\x1b[39m", "sliceAnsi re-emite el cierre");
  },

  peek_desenvuelve_una_promesa_resuelta: () => {
    const p = Promise.resolve(7);
    p.catch(() => {});
    eq(Bun.peek(p), 7, "peek sobre una promesa ya resuelta");
    eq(typeof Bun.cron, "function", "Bun.cron existe (no se programa: se mide la firma)");
  },

  mmap_de_un_archivo_real: () => {
    const src = P("mmap-src.txt");
    writeFileSync(src, "contenido a archivar\n".repeat(3));
    const u = Bun.mmap(src);
    assert(u instanceof Uint8Array, "mmap devuelve Uint8Array: " + Object.getPrototypeOf(u)?.constructor?.name);
    eq(u.byteLength, readFileSync(src).byteLength, "mmap cubre el largo del archivo");
    eq(new TextDecoder().decode(u.subarray(0, 9)), "contenido", "mmap lee los bytes del archivo");
    // Medido: la firma con (length, path) y la de (path, offset, len) ya no existen.
    let lanza = false;
    try { Bun.mmap(128, src); } catch { lanza = true; }
    eq(lanza, true, "Bun.mmap(n, path) no es una firma valida en 1.4.2");
  },

  unix_socket_serve_y_fetch: async () => {
    const sock = P("t10-serve.sock");
    rmSync(sock, { force: true });
    const s = Bun.serve({ unix: sock, fetch: () => new Response("pong-t10") });
    try {
      const r = await fetch("http://localhost/ruta", { unix: sock });
      eq(await r.text(), "pong-t10", "fetch con opcion unix sobre Bionic");
      assert(String(s.url).startsWith("unix://"), "la url del server unix es unix://: " + s.url);
    } finally { s.stop(true); }
  },

  unix_socket_listen_y_cliente_node_net: async () => {
    const { default: net } = await import("node:net");
    const sock = P("t10-listen.sock");
    rmSync(sock, { force: true });
    const recibidos = [];
    const l = Bun.listen({
      unix: sock,
      socket: {
        data(c, d) { const t = new TextDecoder().decode(d); recibidos.push(t); c.write("ECO:" + t); },
        error() {},
      },
    });
    try {
      const got = await withTimeout(8000, () => new Promise((res, rej) => {
        const c = net.createConnection({ path: sock }, () => c.write("hola-unix"));
        let buf = "";
        c.on("data", (b) => { buf += b.toString(); res(buf); c.end(); });
        c.on("error", rej);
      }));
      eq(got, "ECO:hola-unix", "Bun.listen unix responde al cliente node:net");
      eq(recibidos.join("|"), "hola-unix", "el server vio el payload");
    } finally { l.stop(); }
  },

  watch_mode_recarga_el_archivo: async () => {
    const dir = P("watch");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "w.ts"), "console.log(\"RUN-1\");\n");
    const p = Bun.spawn({ cmd: [process.execPath, "--watch", "w.ts"], cwd: dir,
      stdout: "pipe", stderr: "pipe", env: { ...process.env } });
    const acc = [];
    (async () => {
      const rd = p.stdout.getReader();
      for (;;) { const { done, value } = await rd.read(); if (done) break; acc.push(new TextDecoder().decode(value)); }
    })();
    try {
      await Bun.sleep(4000);
      writeFileSync(path.join(dir, "w.ts"), "console.log(\"RUN-2\");\n");
      await Bun.sleep(5000);
      const out = acc.join("");
      assert(out.includes("RUN-1"), "--watch ejecuta la primera version: " + JSON.stringify(out.slice(0, 120)));
      assert(out.includes("RUN-2"), "--watch recarga tras tocar el archivo (fs events de Termux): " + JSON.stringify(out.slice(0, 160)));
    } finally { p.kill(9); }
  },

  node_vm_create_context_y_run: async () => {
    const { default: vm } = await import("node:vm");
    for (const k of ["createContext", "runInContext", "runInNewContext", "runInThisContext", "Script"]) {
      eq(typeof vm[k], "function", "node:vm exporta " + k);
    }
    const ctx = vm.createContext({ a: 1 });
    eq(vm.runInContext("a + 2", ctx), 3, "runInContext ve el contexto");
    eqJSON(vm.runInNewContext("[b, typeof a]", { b: 5 }), [5, "undefined"], "runInNewContext es una isla");
  },

  glob_scan_async_sync_y_match: async () => {
    const dir = P("glob");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(path.join(dir, "sub"), { recursive: true });
    writeFileSync(path.join(dir, "a.ts"), "1");
    writeFileSync(path.join(dir, "b.txt"), "2");
    writeFileSync(path.join(dir, "sub", "c.ts"), "3");
    const g = new Bun.Glob("**/*.{ts,md}");
    const abs = [];
    for await (const p of g.scan({ cwd: dir, absolute: true })) abs.push(p);
    eq(abs.length, 2, "scan ve a.ts y sub/c.ts");
    assert(abs.every((p) => path.isAbsolute(p)), "absolute:true devuelve rutas absolutas");
    // scanSync es un generador: hay que materializarlo (no es un array).
    const rel = [...new Bun.Glob("**/*.ts").scanSync({ cwd: dir })].sort();
    eq(rel.join(","), ["a.ts", path.join("sub", "c.ts")].join(","), "scanSync rinde rutas relativas");
    eqJSON([new Bun.Glob("**/*.ts").match("x/y/z.ts"), new Bun.Glob("**/*.ts").match("x/y/z.tsx")], [true, false], "match respeta la extension");
  },

  import_attributes_file_y_text: async () => {
    // Dos archivos DISTINTOS: el registro de modulos cachea por specifier y
    // el atributo del segundo import() se ignora (lo fija el caso siguiente).
    const srcFile = P("attr-file.txt");
    const srcText = P("attr-text.txt");
    writeFileSync(srcFile, "contenido-embebido");
    writeFileSync(srcText, "contenido-embebido");
    // Medido: `type:"file"` rinde la RUTA ABSOLUTA como string (no un BunFile),
    // y `type:"text"` rinde el contenido.
    const comoArchivo = await import(pathToFileURL(srcFile).href, { with: { type: "file" } });
    eq(typeof comoArchivo.default, "string", "type:file rinde un string");
    eq(path.basename(comoArchivo.default), "attr-file.txt", "type:file rinde la ruta del modulo");
    eq(readFileSync(comoArchivo.default, "utf8"), "contenido-embebido", "esa ruta es legible");
    const comoTexto = await import(pathToFileURL(srcText).href, { with: { type: "text" } });
    eq(comoTexto.default, "contenido-embebido", "type:text rinde el contenido");
  },

  // Semantica medida: la clave del registry es el specifier, NO el par
  // (specifier, attribute). Pedir el mismo modulo con otro atributo devuelve lo
  // que resolvio el primer import, inclusive agregando un #fragmento.
  import_mismo_specifier_con_otro_attribute_devuelve_la_cacheada: async () => {
    const src = P("attr-cache.txt");
    writeFileSync(src, "contenido-embebido");
    const url = pathToFileURL(src).href;
    const primero = await import(url, { with: { type: "file" } });
    eq(path.basename(primero.default), "attr-cache.txt", "el primer atributo gana");
    const despues = await import(url, { with: { type: "text" } });
    eq(typeof despues.default, "string", "el segundo atributo no re-resuelve el modulo");
    eq(despues.default, primero.default, "es el mismo modulo cacheado");
    const conFragmento = await import(url + "#variante", { with: { type: "text" } });
    eq(typeof conFragmento.default, "string", "un #fragmento tampoco cambia la clave");
  },

  await_using_con_async_dispose: async () => {
    let disposed = false;
    class Recurso { async [Symbol.asyncDispose]() { disposed = true; } }
    async function usar() { await using r = new Recurso(); return 1; }
    eq(await usar(), 1, "el cuerpo de await using corre");
    eq(disposed, true, "Symbol.asyncDispose se dispara al salir del scope");
  },

  test_runner_con_mock_spyon_y_coverage: async () => {
    const dir = P("cov");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "ok.test.ts"), [
      "import { test, expect, mock, spyOn } from \"bun:test\";",
      "const f = mock(() => 1);",
      "test(\"suma\", () => { expect(1 + 1).toBe(2); f(); expect(f.mock.calls.length).toBe(1); });",
      "test(\"spyOn\", () => { const o = { m: () => 5 }; const s = spyOn(o, \"m\"); o.m(); expect(s.mock.calls.length).toBe(1); s.mockRestore(); });",
      "",
    ].join("\n"));
    const r = Bun.spawnSync({ cmd: [process.execPath, "test", "--coverage", "ok.test.ts"], cwd: dir,
      stdout: "pipe", stderr: "pipe" });
    const out = String(r.stdout) + String(r.stderr);
    eq(r.exitCode, 0, "bun test con todo verde sale 0");
    assert(/2 pass/.test(out) && /0 fail/.test(out), "los dos tests corren: " + out.slice(-160));
    const t = await import("bun:test");
    eq(typeof t.spyOn, "function", "bun:test exporta spyOn");
    eq(t.spy, undefined, "bun:test NO exporta spy (importarlo es un SyntaxError medido)");
    // Limitacion medida, IDENTICA en el oraculo 1.3.14 del dispositivo: el flag
    // --coverage no emite la tabla de cobertura en los builds de Android.
    assert(!out.includes("%"), "--coverage no imprime tabla de porcentajes (igual en 1.3.14)");
  },

  sqlite_load_extension_falla_sin_matar: () => {
    const db = new Database(":memory:");
    eq(typeof db.loadExtension, "function", "la API existe");
    let msg = "";
    try { db.loadExtension(process.env.PREFIX + "/lib/libsqlite3.so"); }
    catch (e) { msg = String(e && e.message); }
    // Medido igual en 1.3.14: bun exporta loadExtension pero su sqlite no tiene
    // el simbolo de extension. Que el proceso sobreviva es lo que se fija.
    assert(msg.length > 0, "loadExtension lanza en vez de corromper: " + msg);
    assert(/undefined symbol/i.test(msg), "el error nombra el simbolo que falta: " + msg);
    eq(db.query("select 1 as one").get().one, 1, "la conexion sigue util despues del throw");
    db.close();
  },

  dns_getservers_devuelve_el_loopback_de_android: () => {
    const servers = Bun.dns.getServers();
    assert(Array.isArray(servers), "getServers es un array: " + JSON.stringify(servers));
    assert(servers.length > 0, "hay al menos un resolver configurado");
    for (const s of servers) {
      assert(/^(\d+\.){3}\d+$|^[0-9a-fA-F:]+$/.test(s), "cada resolver es una IP: " + s);
    }
    // Termux: el resolver que ve bun es el loopback del dnsproxyd de Android
    // (127.0.0.1), unreachable desde el uid — la causa del KNOWN de node:dns.
  },

  standalone_flag_y_embedded_files_fuera_de_compile: () => {
    eq(Bun.isStandaloneExecutable, false, "corriendo como script no somos standalone");
    eq(Bun.embeddedFiles.length, 0, "sin --compile no hay archivos embebidos");
    assert(Array.isArray(Bun.embeddedFiles), "embeddedFiles es un array");
  },

  sha_y_cryptohasher_valores_fijos: () => {
    const hex = new Bun.CryptoHasher("sha256").update("hola").digest("hex");
    eq(hex, "b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79", "sha256 de 'hola'");
    const hmac = new Bun.CryptoHasher("sha256", "key").update("msg").digest("hex");
    eq(hmac.slice(0, 16), "2d93cbc1be167bcb", "HMAC-SHA256 con clave es deterministico");
    // Medido: `Bun.sha` existe y rinde 32 bytes, pero NO es el sha256 de
    // CryptoHasher (arranca 49,11,de,...); se fija lo que si se puede fijar.
    const digest = new Uint8Array(Bun.sha("hola"));
    eq(digest.length, 32, "Bun.sha rinde 32 bytes");
    eq(new Uint8Array(Bun.sha("hola")).join(","), digest.join(","), "Bun.sha es deterministico");
    assert(new Uint8Array(Bun.sha("hola!")).join(",") !== digest.join(","), "Bun.sha cambia con el input");
  },

  // ---- Los cuatro stubs: miden rojo en NUESTRO ELF, pero el oráculo oficial
  // 1.3.14 de Android da EXACTAMENTE lo mismo (ver docs/KNOWN-ISSUES.md). ----

  archive_zip_roundtrip_real: async () => {
    const out = P("t10.zip");
    rmSync(out, { force: true });
    await Bun.Archive.write(out, { files: [{ name: "a.txt", data: "hola-a" }, { name: "dir/b.txt", data: "hola-b" }] });
    assert(existsSync(out), "el archivo de salida se crea");
    const head = readFileSync(out).subarray(0, 2);
    const magic = String.fromCharCode(head[0], head[1]);
    eq(magic, "PK", "un zip real empieza con PK (medido: escribe otra cosa)");
    const a = new Bun.Archive({ file: Bun.file(out) });
    const files = await a.files;
    eq(files.length, 2, "los dos archivos se listan al releer");
  },

  image_resize_y_encode: async () => {
    const src = P("px.png");
    writeFileSync(src, PNG_1X1);
    const img = new Bun.Image(src);
    const dims = await withTimeout(8000, async () => ({ w: img.width, h: img.height }));
    eq(dims.w, 1, "el png 1x1 reporta width=1 (medido: -1 en Android)");
    const out = await withTimeout(8000, () => img.resize(2, 2).png());
    assert(out && (out.byteLength ?? out.size ?? 0) > 8, "la codificacion png produce bytes");
  },

  csrf_verify_con_el_mismo_secret: () => {
    const token = Bun.CSRF.generate("clave-super-secreta");
    eq(typeof token, "string", "generate devuelve un token string");
    assert(token.length >= 16, "el token tiene longitud util: " + token.length);
    eq(Bun.CSRF.verify("clave-super-secreta", token), true, "verify con el mismo secret (medido: false)");
    eq(Bun.CSRF.verify("otra-clave", token), false, "verify rechaza otro secret");
  },

  index_of_line_con_string_con_newline: () => {
    // Semantica medida sobre Buffer: devuelve el indice del \\n que cierra la
    // linea que contiene a `pos`. En "a\nbb\nccc" la linea de pos=3 cierra en 4.
    eq(Bun.indexOfLine(Buffer.from("a\nbb\nccc"), 3), 4, "indexOfLine sobre Buffer si resuelve");
    eq(Bun.indexOfLine("a\nbb\nccc", 3), 4, "indexOfLine sobre string deberia dar lo mismo (medido: -1)");
  },
};

export default caseMain(cases);
