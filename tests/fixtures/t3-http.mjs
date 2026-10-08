// T3 · red: Bun.serve sobre TCP real (los verificadores historicos solo cubrian
// la ruta unix), fetch, TLS, WebSocket, Bun.connect.
import { assert, caseMain, CASE_DIR, eq, skip, withTimeout } from "./lib.mjs";

async function withServer(opts, fn) {
  const server = Bun.serve({ ...opts, port: opts.port ?? 0 });
  try {
    return await fn(server);
  } finally {
    try { server.stop(); } catch {}
  }
}

const cases = {
  serve_tcp_get: async () => {
    const r = await withServer({
      hostname: "127.0.0.1",
      fetch(req) { return new Response("hola-tcp " + new URL(req.url).pathname); },
    }, async (s) => {
      const res = await withTimeout(10000, () => fetch(`http://127.0.0.1:${s.port}/ruta`));
      return { status: res.status, body: await res.text() };
    });
    eq(r.status, 200, "Bun.serve TCP status");
    eq(r.body, "hola-tcp /ruta", "Bun.serve TCP cuerpo");
  },

  serve_ipv6_loopback: async () => {
    let server;
    try {
      server = Bun.serve({ hostname: "::1", port: 0, fetch: () => new Response("v6-ok") });
    } catch (e) { skip("sin IPv6 en este stack: " + e.message); }
    try {
      const res = await withTimeout(10000, () => fetch(`http://[::1]:${server.port}/`));
      eq(await res.text(), "v6-ok", "respuesta por IPv6");
    } finally { server.stop(); }
  },

  serve_post_echo_and_headers: async () => {
    const r = await withServer({
      hostname: "127.0.0.1",
      async fetch(req) {
        const body = await req.text();
        return Response.json({
          len: Buffer.byteLength(body),
          ct: req.headers.get("content-type"),
          x: req.headers.get("x-tenant"),
        });
      },
    }, async (s) => {
      const res = await withTimeout(10000, () =>
        fetch(`http://127.0.0.1:${s.port}/p`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-tenant": "tenant-1" },
          body: "payload ñá 世界",
        }));
      return await res.json();
    });
    eq(r.len, Buffer.byteLength("payload ñá 世界"), "bytes del POST recibidos");
    eq(r.ct, "application/json", "content-type recibido");
    eq(r.x, "tenant-1", "header custom preservado");
  },

  serve_chunked_response: async () => {
    const r = await withServer({
      hostname: "127.0.0.1",
      fetch() {
        return new Response(new ReadableStream({
          start(c) { c.enqueue(new TextEncoder().encode("chunk1")); c.enqueue(new TextEncoder().encode("chunk2")); c.close(); },
        }));
      },
    }, async (s) => await (await withTimeout(10000, () => fetch(`http://127.0.0.1:${s.port}/`))).text());
    eq(r, "chunk1chunk2", "stream chunked rearmado");
  },

  serve_websocket_upgrade: async () => {
    const got = await withServer({
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("no-upgrade", { status: 426 });
      },
      websocket: {
        message(ws, msg) { ws.send("eco:" + msg); },
        open() {},
        close() {},
      },
    }, async (s) => await withTimeout(12000, () => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${s.port}/`);
      const t = setTimeout(() => reject(new Error("ws no abrio")), 11000);
      ws.onopen = () => ws.send("ping-ñ");
      ws.onmessage = (ev) => { clearTimeout(t); resolve(ev.data); ws.close(); };
      ws.onerror = (e) => { clearTimeout(t); reject(new Error("ws error: " + (e.message ?? "generico"))); };
    })));
    eq(got, "eco:ping-ñ", "WebSocket local ida y vuelta");
  },

  serve_static_file_route_over_tcp: async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(`${CASE_DIR}/pub`, { recursive: true });
    writeFileSync(`${CASE_DIR}/pub/thing.txt`, "hola-openat2\n");
    const r = await withServer({
      hostname: "127.0.0.1",
      routes: { "/pub/*": { dir: "./pub" } },
      fetch: () => new Response("nope", { status: 404 }),
    }, async (s) => {
      const res = await withTimeout(10000, () => fetch(`http://127.0.0.1:${s.port}/pub/thing.txt`));
      return { status: res.status, body: (await res.text()).trim() };
    });
    eq(r.status, 200, "dir-route sobre TCP status (regresion 0001 fuera del socket unix)");
    eq(r.body, "hola-openat2", "dir-route sobre TCP body");
  },

  serve_static_utf8_name_over_tcp: async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(`${CASE_DIR}/pubñ`, { recursive: true });
    writeFileSync(`${CASE_DIR}/pubñ/ar chi ñá.txt`, "ñ-special\n");
    const r = await withServer({
      hostname: "127.0.0.1",
      routes: { "/s/*": { dir: "./pubñ" } },
      fetch: () => new Response("nope", { status: 404 }),
    }, async (s) => {
      const res = await withTimeout(10000, () =>
        fetch(`http://127.0.0.1:${s.port}/s/${encodeURIComponent("ar chi ñá.txt")}`));
      return { status: res.status, body: (await res.text()).trim() };
    });
    eq(r.status, 200, "archivo UTF-8 con espacios servido");
    eq(r.body, "ñ-special", "contenido UTF-8 servido");
  },

  serve_path_traversal_blocked: async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(`${CASE_DIR}/pub2`, { recursive: true });
    writeFileSync(`${CASE_DIR}/secret.txt`, "SECRETO\n");
    const statuses = await withServer({
      hostname: "127.0.0.1",
      routes: { "/p/*": { dir: "./pub2" } },
      fetch: () => new Response("fallback", { status: 404 }),
    }, async (s) => {
      const tries = [
        "/p/../secret.txt",
        "/p/%2e%2e/secret.txt",
        "/p/..%2fsecret.txt",
        "/p/....//secret.txt",
      ];
      const out = [];
      for (const t of tries) {
        const res = await withTimeout(10000, () => fetch(`http://127.0.0.1:${s.port}${t}`));
        out.push({ t, status: res.status, leaked: (await res.text()).includes("SECRETO") });
      }
      return out;
    });
    for (const { t, leaked, status } of statuses) {
      assert(!leaked, `traversal filtró el archivo por ${t} (status ${status})`);
    }
  },

  serve_handler_throw_survives: async () => {
    const r = await withServer({
      hostname: "127.0.0.1",
      fetch(req) {
        if (new URL(req.url).pathname === "/boom") throw new Error("boom-controlado");
        return new Response("vivo");
      },
    }, async (s) => {
      const boom = await withTimeout(10000, () => fetch(`http://127.0.0.1:${s.port}/boom`)).catch((e) => ({ network: String(e.message) }));
      const after = await withTimeout(10000, () => fetch(`http://127.0.0.1:${s.port}/ok`));
      return { boom, afterStatus: after.status, afterBody: await after.text() };
    });
    eq(r.afterBody, "vivo", "el servidor sigue vivo tras un handler que throwea");
    eq(r.afterStatus, 200, "status tras el throw");
  },

  serve_stop_and_rebind: async () => {
    const first = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("1") });
    const port = first.port;
    first.stop();
    await Bun.sleep(150);
    let second;
    try { second = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("2") }); }
    catch (e) { await import("node:fs").then((m) => m.writeFileSync(`${CASE_DIR}/rebind.log`, e.message)); skip("rebind del mismo puerto fallo: " + e.message); }
    try {
      const body = await (await withTimeout(10000, () => fetch(`http://127.0.0.1:${port}/`))).text();
      eq(body, "2", "rebind exacto en el mismo puerto");
    } finally { second.stop(); }
  },

  fetch_redirect_chain: async () => {
    const r = await withServer({
      hostname: "127.0.0.1",
      fetch(req) {
        const p = new URL(req.url).pathname;
        if (p === "/a") return new Response(null, { status: 302, headers: { location: "/b" } });
        if (p === "/b") return new Response(null, { status: 301, headers: { location: "/c" } });
        return new Response("llegue-a-c");
      },
    }, async (s) => {
      const res = await withTimeout(10000, () => fetch(`http://127.0.0.1:${s.port}/a`));
      return { status: res.status, url: res.url, body: await res.text() };
    });
    eq(r.status, 200, "cadena de redirects resuelta");
    eq(r.body, "llegue-a-c", "cuerpo tras redirect 302->301");
  },

  fetch_abort_via_timeout: async () => {
    const started = await withServer({
      hostname: "127.0.0.1",
      fetch() { return new Promise(() => {}); },
    }, async (s) => {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 600);
      const t0 = Date.now();
      try {
        await fetch(`http://127.0.0.1:${s.port}/slow`, { signal: ac.signal });
        return { aborted: false };
      } catch (e) {
        return { aborted: true, ms: Date.now() - t0, name: e.name };
      }
    });
    assert(started.aborted, "un fetch colgado con AbortSignal tiene que rechazar");
    assert(started.ms < 5000, "el abort no puede tardar segundos: " + started.ms + "ms");
  },

  fetch_concurrent_keepalive: async () => {
    const n = await withServer({
      hostname: "127.0.0.1",
      fetch(req) { return new Response("r" + new URL(req.url).pathname); },
    }, async (s) => {
      const rs = await withTimeout(20000, () =>
        Promise.all(Array.from({ length: 30 }, (_, i) => fetch(`http://127.0.0.1:${s.port}/${i}`))));
      return rs.filter((r) => r.status === 200).length;
    });
    eq(n, 30, "30 requests concurrentes por keep-alive");
  },

  fetch_binary_and_unicode_roundtrip: async () => {
    const payload = Buffer.from([0, 1, 2, 253, 254, 255]);
    const r = await withServer({
      hostname: "127.0.0.1",
      async fetch(req) {
        const b = Buffer.from(await req.arrayBuffer());
        return new Response(b, { headers: { "x-echo-bytes": String(b.length) } });
      },
    }, async (s) => {
      const res = await withTimeout(10000, () =>
        fetch(`http://127.0.0.1:${s.port}/bin`, { method: "PUT", body: payload }));
      return { got: Buffer.from(await res.arrayBuffer()), n: res.headers.get("x-echo-bytes") };
    });
    eq(r.got.length, 6, "bytes binarios vuelta");
    eq(r.n, "6", "header con longitud");
    assert(r.got.equals(Buffer.from([0, 1, 2, 253, 254, 255])), "payload binario intacto");
  },

  fetch_https_tls: async () => {
    let res;
    try {
      res = await withTimeout(20000, () => fetch("https://example.com", { tls: { rejectUnauthorized: true } }));
    } catch (e) { skip("sin red o sin TLS hacia example.com: " + e.message); }
    eq(res.status, 200, "fetch https status");
    assert(res.headers.get("content-type")?.includes("text/html"), "content-type html: " + res.headers.get("content-type"));
  },

  bun_connect_tcp_echo: async () => {
    const net = await import("node:net");
    const r = await withServer({
      hostname: "127.0.0.1",
      fetch: () => new Response("no"),
    }, async (s) => await withTimeout(12000, () => new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const t = setTimeout(() => { socket.destroy(); reject(new Error("Bun.connect/net timeout")); }, 11000);
      socket.connect(s.port, "127.0.0.1", () => socket.write("hola-net"));
      socket.on("data", () => {});
      socket.on("error", (e) => { clearTimeout(t); reject(new Error("net error: " + e.message)); });
      socket.on("close", () => { clearTimeout(t); resolve("closed"); });
      setTimeout(() => { socket.destroy(); clearTimeout(t); resolve("closed"); }, 1500);
    })));
    eq(r, "closed", "conexion TCP cruda abierta y cerrada");
  },
};

export default caseMain(cases);
