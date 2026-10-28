// Deno test: `deno test --allow-net --allow-read --allow-env tests/edge/` with TLS_DIR pointing at a CA-signed
// cert for shop.test (see tests/edge/README.md). Proves the connection goes to the pinned IP with the store
// hostname as TLS name, without any DNS lookup, and that a wrong certificate name is refused.
import { pinnedGet } from "../../supabase/functions/weconvert-woocommerce/pinned.mjs";

const dir = Deno.env.get("TLS_DIR");
const ca = dir ? await Deno.readTextFile(dir + "/ca.pem") : "";
const assert = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };

Deno.test({ name: "pinned GET reaches the verified IP with SNI, gzip and chunked bodies", ignore: !dir, async fn() {
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, cert: await Deno.readTextFile(dir + "/srv.pem"), key: await Deno.readTextFile(dir + "/srv.key"), onListen() {} }, (req) => {
    const u = new URL(req.url);
    if (u.pathname === "/gz") {
      const gz = new Blob([JSON.stringify({ zipped: true })]).stream().pipeThrough(new CompressionStream("gzip"));
      return new Response(gz, { headers: { "content-type": "application/json", "content-encoding": "gzip" } });
    }
    if (u.pathname === "/stream") {
      const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"a":')); c.enqueue(new TextEncoder().encode('1}')); c.close(); } });
      return new Response(body, { headers: { "content-type": "application/json" } });
    }
    return Response.json({ path: u.pathname + u.search, auth: req.headers.get("authorization"), host: req.headers.get("host"), pad: "x".repeat(2000) }, { headers: { "x-wp-total": "7" } });
  });
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const r = await pinnedGet({ url: `https://shop.test:${port}/wp-json/wc/v3/orders?per_page=1`, ip: "127.0.0.1", headers: { Authorization: "Basic abc" }, caCerts: [ca] });
    assert(r.status === 200, "status");
    const j = JSON.parse(r.text);
    assert(j.path === "/wp-json/wc/v3/orders?per_page=1" && j.auth === "Basic abc" && j.host === `shop.test:${port}`, "request line/headers: " + r.text.slice(0, 120));
    assert(r.headers.get("x-wp-total") === "7", "response headers");
    const g = await pinnedGet({ url: `https://shop.test:${port}/gz`, ip: "127.0.0.1", caCerts: [ca] });
    assert(JSON.parse(g.text).zipped === true && g.headers.get("content-encoding") === "gzip", "gzip body decoded");
    const s = await pinnedGet({ url: `https://shop.test:${port}/stream`, ip: "127.0.0.1", caCerts: [ca] });
    assert(s.text === '{"a":1}', "chunked: " + s.text);
    let refused = false;
    try { await pinnedGet({ url: `https://other.test:${port}/x`, ip: "127.0.0.1", caCerts: [ca] }); } catch (e) { refused = (e as Error).message === "WOO_UNREACHABLE"; }
    assert(refused, "certificate for another host must be refused");
    let tooBig = false;
    try { await pinnedGet({ url: `https://shop.test:${port}/big`, ip: "127.0.0.1", caCerts: [ca], max: 100 }); } catch (e) { tooBig = (e as Error).message === "PAYLOAD_TOO_LARGE"; }
    assert(tooBig, "size limit");
  } finally {
    await server.shutdown();
  }
} });
