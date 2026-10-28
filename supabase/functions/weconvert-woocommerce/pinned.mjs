// Outbound HTTPS to a merchant store, pinned to the IP address that was checked.
//
// fetch() resolves the hostname again after our DNS check, so a store domain with a very short TTL could
// answer a public IP to the check and a private one to fetch (DNS rebinding → SSRF). Here the TCP
// connection is opened to the verified IP itself, then TLS is negotiated with the store hostname as SNI and
// certificate name. The certificate must still be valid for that hostname; no second DNS lookup happens.
import { WooError } from "./domain.mjs";

const decoder = new TextDecoder();

function indexOf(bytes, pattern, from = 0) {
  outer: for (let i = from; i <= bytes.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) if (bytes[i + j] !== pattern[j]) continue outer;
    return i;
  }
  return -1;
}

const CRLF = new Uint8Array([13, 10]);
const HEADER_END = new Uint8Array([13, 10, 13, 10]);

function dechunk(body, max) {
  const out = [];
  let size = 0;
  let at = 0;
  while (true) {
    const lineEnd = indexOf(body, CRLF, at);
    if (lineEnd < 0) throw new WooError("WOO_RESPONSE", 502);
    const len = parseInt(decoder.decode(body.subarray(at, lineEnd)).split(";")[0].trim(), 16);
    if (!Number.isFinite(len) || len < 0) throw new WooError("WOO_RESPONSE", 502);
    at = lineEnd + 2;
    if (len === 0) break;
    if (at + len > body.length) throw new WooError("WOO_RESPONSE", 502);
    size += len;
    if (size > max) throw new WooError("PAYLOAD_TOO_LARGE", 413);
    out.push(body.subarray(at, at + len));
    at += len + 2;
  }
  const joined = new Uint8Array(size);
  let o = 0;
  for (const part of out) {
    joined.set(part, o);
    o += part.length;
  }
  return joined;
}

async function decode(bytes, encoding, max) {
  const enc = (encoding || "identity").trim().toLowerCase();
  if (enc === "identity" || enc === "") return bytes;
  if (enc !== "gzip" && enc !== "deflate") throw new WooError("WOO_RESPONSE", 502);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(enc));
  const reader = stream.getReader();
  const parts = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new WooError("PAYLOAD_TOO_LARGE", 413);
    }
    parts.push(value);
  }
  const joined = new Uint8Array(size);
  let o = 0;
  for (const part of parts) {
    joined.set(part, o);
    o += part.length;
  }
  return joined;
}

/** Parses a complete HTTP/1.1 response (connection closed by the server). Pure: tested with node:test. */
export async function parseHttpResponse(raw, max = 4_000_000) {
  const end = indexOf(raw, HEADER_END);
  if (end < 0 || end > 65536) throw new WooError("WOO_RESPONSE", 502);
  const lines = decoder.decode(raw.subarray(0, end)).split("\r\n");
  const status = /^HTTP\/1\.[01] (\d{3})(?: .*)?$/.exec(lines[0] || "");
  if (!status) throw new WooError("WOO_RESPONSE", 502);
  const headers = new Headers();
  for (const line of lines.slice(1)) {
    const i = line.indexOf(":");
    if (i < 1) throw new WooError("WOO_RESPONSE", 502);
    headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  let body = raw.subarray(end + 4);
  if (/\bchunked\b/i.test(headers.get("transfer-encoding") || "")) body = dechunk(body, max);
  else if (headers.has("content-length")) {
    const len = Number(headers.get("content-length"));
    if (!Number.isSafeInteger(len) || len < 0) throw new WooError("WOO_RESPONSE", 502);
    if (len > max) throw new WooError("PAYLOAD_TOO_LARGE", 413);
    if (body.length < len) throw new WooError("WOO_RESPONSE", 502);
    body = body.subarray(0, len);
  }
  if (body.length > max) throw new WooError("PAYLOAD_TOO_LARGE", 413);
  const decoded = await decode(body, headers.get("content-encoding"), max);
  return { status: Number(status[1]), headers, text: decoder.decode(decoded) };
}

/**
 * GET over TLS to `ip`, presenting `url`'s hostname for SNI and certificate validation.
 * `net` is injectable for tests ({ connect, startTls }); defaults to Deno's.
 */
export async function pinnedGet({ url, ip, headers = {}, timeoutMs = 12000, max = 4_000_000, caCerts = undefined, net = undefined }) {
  const target = new URL(url);
  if (target.protocol !== "https:") throw new WooError("INVALID_URL");
  const port = Number(target.port || 443);
  const io = net || { connect: (o) => Deno.connect(o), startTls: (c, o) => Deno.startTls(c, o) };
  let conn;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      conn?.close();
    } catch {}
  }, timeoutMs);
  try {
    const tcp = await io.connect({ hostname: ip, port, transport: "tcp" });
    conn = tcp;
    conn = await io.startTls(tcp, { hostname: target.hostname, ...(caCerts ? { caCerts } : {}) });
    const head = [
      `GET ${target.pathname}${target.search} HTTP/1.1`,
      `Host: ${target.host}`,
      "Connection: close",
      "Accept-Encoding: gzip, identity",
      "User-Agent: WeConvert-CRM/1.0",
      ...Object.entries(headers).map(([k, v]) => {
        if (/[\r\n]/.test(k + v)) throw new WooError("INVALID_REQUEST");
        return `${k}: ${v}`;
      }),
      "",
      "",
    ].join("\r\n");
    const request = new TextEncoder().encode(head);
    for (let sent = 0; sent < request.length; ) sent += await conn.write(request.subarray(sent));
    const chunks = [];
    let size = 0;
    let bodyStart = -1;
    let expected = -1; // total bytes when Content-Length is known
    let chunked = false;
    const buf = new Uint8Array(32 * 1024);
    // Some servers ignore "Connection: close": stop as soon as the declared body has fully arrived.
    while (true) {
      const n = await conn.read(buf);
      if (n === null) break;
      size += n;
      if (size > max + 70_000) throw new WooError("PAYLOAD_TOO_LARGE", 413);
      chunks.push(buf.slice(0, n));
      if (bodyStart < 0 && size <= 70_000) {
        const head = new Uint8Array(size);
        let o = 0;
        for (const c of chunks) {
          head.set(c, o);
          o += c.length;
        }
        const end = indexOf(head, HEADER_END);
        if (end >= 0) {
          bodyStart = end + 4;
          const text = decoder.decode(head.subarray(0, end));
          chunked = /\r\ntransfer-encoding:[^\r]*chunked/i.test(text);
          const len = /\r\ncontent-length:\s*(\d+)/i.exec(text);
          if (!chunked && len) expected = bodyStart + Number(len[1]);
        }
      }
      if (expected >= 0 && size >= expected) break;
      if (chunked && bodyStart >= 0) {
        const last = chunks[chunks.length - 1];
        const tail = last.length >= 5 ? last.subarray(last.length - 5) : null;
        if (tail && decoder.decode(tail) === "0\r\n\r\n" && size - bodyStart >= 5) break;
      }
    }
    const raw = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) {
      raw.set(c, o);
      o += c.length;
    }
    return await parseHttpResponse(raw, max);
  } catch (e) {
    if (e instanceof WooError && !timedOut) throw e;
    throw new WooError("WOO_UNREACHABLE", 502);
  } finally {
    clearTimeout(timer);
    try {
      conn?.close();
    } catch {}
  }
}
