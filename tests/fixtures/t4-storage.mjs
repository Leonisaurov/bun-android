// T4 · storage: bun:sqlite en archivo real de Termux, WAL, transacciones,
// blobs; Bun.file, Bun.write, hash, Blob/FormData.
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { assert, caseMain, CASE_DIR, eq, withTimeout } from "./lib.mjs";

const P = (...p) => path.join(CASE_DIR, ...p);

const cases = {
  sqlite_file_persistence: () => {
    const f = P("persist.sqlite");
    const db = new Database(f);
    db.run("PRAGMA journal_mode=WAL");
    db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    db.run("INSERT INTO t (v) VALUES ('uno'), ('dos')");
    db.close();
    const db2 = new Database(f);
    const rows = db2.query("SELECT id, v FROM t ORDER BY id").all();
    db2.close();
    eq(rows.length, 2, "filas persistidas tras cerrar y reabrir");
    eq(rows[0].v, "uno", "valor correcto tras reapertura");
    assert(existsSync(f), "el archivo existe");
  },

  sqlite_wal_two_connections: () => {
    const f = P("wal.sqlite");
    const a = new Database(f);
    a.run("PRAGMA journal_mode=WAL");
    a.run("CREATE TABLE t (x INTEGER)");
    const b = new Database(f);
    b.run("PRAGMA journal_mode=WAL");
    a.run("INSERT INTO t VALUES (1)");
    b.run("INSERT INTO t VALUES (2)");
    const total = b.query("SELECT count(*) AS c FROM t").get().c;
    eq(total, 2, "dos conexiones escriben bajo WAL");
    a.close(); b.close();
  },

  sqlite_transaction_rollback: () => {
    const db = new Database(P("tx.sqlite"));
    db.run("CREATE TABLE t (x INTEGER)");
    try {
      db.transaction(() => { db.run("INSERT INTO t VALUES (1)"); throw new Error("abort"); })();
    } catch {}
    eq(db.query("SELECT count(*) AS c FROM t").get().c, 0, "el transaction debe revertir el insert");
    db.transaction(() => { db.run("INSERT INTO t VALUES (2)"); db.run("INSERT INTO t VALUES (3)"); })();
    eq(db.query("SELECT count(*) AS c FROM t").get().c, 2, "transaction exitosa commitea");
    db.close();
  },

  sqlite_blob_roundtrip_1mb: () => {
    const db = new Database(P("blob.sqlite"));
    db.run("CREATE TABLE b (id INTEGER PRIMARY KEY, data BLOB)");
    const payload = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
    const ins = db.prepare("INSERT INTO b (data) VALUES (?)");
    ins.run(payload);
    const got = db.query("SELECT data FROM b WHERE id = 1").get().data;
    const buf = Buffer.from(got);
    eq(buf.length, payload.length, "blob de 1 MB con tamanho intacto");
    assert(buf.equals(payload), "blob de 1 MB byte a byte");
    db.close();
  },

  sqlite_prepared_bulk_10k: () => {
    const db = new Database(P("bulk.sqlite"));
    db.run("CREATE TABLE t (i INTEGER, s TEXT)");
    const stmt = db.prepare("INSERT INTO t VALUES (?, ?)");
    const t0 = Date.now();
    db.transaction(() => { for (let i = 0; i < 10000; i++) stmt.run(i, "fila-" + i); })();
    const ms = Date.now() - t0;
    eq(db.query("SELECT count(*) AS c FROM t").get().c, 10000, "10k inserts con prepared statement");
    eq(db.query("SELECT s FROM t WHERE i = 9999").get().s, "fila-9999", "lectura indexada correcta");
    assert(ms < 60000, "10k inserts no puede tardar " + ms + "ms");
    db.close();
  },

  sqlite_json_and_types: () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE t (j TEXT, r REAL, n NUMERIC)");
    db.prepare("INSERT INTO t VALUES (?,?,?)").run(JSON.stringify({ a: [1, 2] }), 1.5, 42);
    const row = db.query("SELECT * FROM t").get();
    eq(JSON.parse(row.j).a[1], 2, "columna TEXT con JSON");
    eq(row.r, 1.5, "REAL");
    eq(Number(row.n), 42, "NUMERIC");
    eq(db.query("SELECT json_extract(t.j, '$.a[1]') AS v FROM t").get().v, 2, "json_extract nativo de sqlite");
    db.close();
  },

  bun_file_write_read_slice: async () => {
    const f = P("bunfile.txt");
    await Bun.write(f, "0123456789ABCDEFGHIJ");
    eq(await Bun.file(f).text(), "0123456789ABCDEFGHIJ", "Bun.write + text()");
    const sliced = await Bun.file(f).slice(5, 10).text();
    eq(sliced, "56789", "Bun.file().slice()");
    const buf = await Bun.file(f).arrayBuffer();
    eq(buf.byteLength, 20, "arrayBuffer length");
    eq(statSync(f).size, 20, "stat coincide");
  },

  bun_write_buffer_and_response: async () => {
    const f = P("out.json");
    await Bun.write(f, Response.json({ ok: true, ñ: "sí" }));
    const obj = JSON.parse(readFileSync(f, "utf8"));
    eq(obj.ok, true, "Response.json escrito a archivo");
    eq(obj.ñ, "sí", "UTF-8 en archivo escrito por Bun.write");
    await Bun.write(P("buf.bin"), Buffer.from("binario"));
    eq((await Bun.file(P("buf.bin")).text()), "binario", "Buffer escrito");
  },

  bun_hash_stable: () => {
    const a = Bun.hash("bun-android-bateria");
    const b = Bun.hash(Buffer.from("bun-android-bateria"));
    eq(Number(a), Number(b), "Bun.hash coincide string vs Buffer");
    eq(Number(Bun.hash("bun-android-bateria")), Number(a), "hash determinista");
    eq(Bun.hash("distinto") === a, false, "hashes distintos no colisionan aqui");
    // Utilidades de superficie Bun que si existen en 1.3.14 y 1.4.2:
    eq(Bun.stringWidth("ñá"), 2, "Bun.stringWidth con UTF-8");
    eq(typeof Bun.which("sh"), "string", "Bun.which resuelve un binario de PATH");
  },

  blob_and_formdata: async () => {
    const blob = new Blob(["ñá", "más"], { type: "text/plain" });
    eq(await blob.text(), "ñámás", "Blob concatena partes UTF-8");
    eq(blob.size, Buffer.byteLength("ñámás"), "Blob.size en bytes");
    const fd = new FormData();
    fd.append("campo", "valor ñ");
    fd.append("archivo", new Blob([Buffer.from("contenido")], { type: "application/octet-stream" }), "f.bin");
    const res = new Response(fd);
    const back = await res.formData();
    eq(back.get("campo"), "valor ñ", "FormData roundtrip por Request/Response");
    assert(back.get("archivo") instanceof File, "archivo como File tras el roundtrip");
    eq(await back.get("archivo").text(), "contenido", "contenido del File");
  },

  stream_to_file_and_back: async () => {
    const src = new ReadableStream({
      start(c) { for (let i = 0; i < 100; i++) c.enqueue(new TextEncoder().encode("linea-" + i + "\n")); c.close(); },
    });
    const f = P("streamed.txt");
    await Bun.write(f, src);
    const text = await Bun.file(f).text();
    eq(text.split("\n").filter(Boolean).length, 100, "100 lineas por stream a archivo");
    assert(text.startsWith("linea-0\n") && text.includes("linea-99"), "orden del stream preservado");
  },

  unlink_and_eperm_paths: () => {
    const f = P("doomed.txt");
    Bun.write(f, "x");
    unlinkSync(f);
    assert(!existsSync(f), "unlink borra");
    let threw = null;
    try { unlinkSync(P("no-existe.txt")); } catch (e) { threw = e.code; }
    eq(threw, "ENOENT", "unlink de archivo ausente debe ser ENOENT, no un crash");
  },
};

export default caseMain(cases);
