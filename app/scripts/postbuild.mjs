// Same browser hardening as the legacy build: strict CSP (the Supabase session lives in localStorage,
// so no injected or inline script may run), plus Cloudflare Pages security headers.
import { readFile, readdir, writeFile } from "node:fs/promises"

const fallback = JSON.parse(await readFile(new URL("../../src/config.json", import.meta.url), "utf8"))
const url = new URL(process.env.VITE_SUPABASE_URL || fallback.url)
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  `connect-src 'self' ${url.origin} wss://${url.host}`,
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ")

const indexPath = new URL("../dist/index.html", import.meta.url)
let html = await readFile(indexPath, "utf8")
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) throw new Error("Inline <script> found: the CSP would block it.")
html = html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/g, "")
html = html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`)
await writeFile(indexPath, html)

await writeFile(
  new URL("../dist/_headers", import.meta.url),
  "/*\n  Content-Security-Policy: " + csp + "; frame-ancestors 'none'\n  X-Frame-Options: DENY\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n\n/index.html\n  Cache-Control: no-cache\n",
)
// A real secret key looks like sb_secret_<random>; supabase-js itself only contains the bare prefix.
const assets = new URL("../dist/assets/", import.meta.url)
for (const name of await readdir(assets)) {
  const text = await readFile(new URL(name, assets), "utf8").catch(() => "")
  if (/sb_secret_[A-Za-z0-9_-]{8,}|"role"\s*:\s*"service_role"/.test(text)) throw new Error("Secret key material in " + name)
}
console.log("CSP and _headers written for", url.origin)
