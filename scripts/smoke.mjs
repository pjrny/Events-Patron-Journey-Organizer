#!/usr/bin/env node
// Usage:
//   BASE_URL=https://events-patronjourney.<subdomain>.workers.dev ADMIN_TOKEN=... npm run smoke
//   add WRITE_PROBE=1 to create the single disposable "PJ Organizer API Probe" event (unpublished, archived).
// Prints responses from the Worker only. The Worker never returns secret values.
const base = (process.env.BASE_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const admin = process.env.ADMIN_TOKEN || "";
const h = admin ? { authorization: `Bearer ${admin}` } : {};

async function hit(method, path) {
  const r = await fetch(base + path, { method, headers: h });
  const t = await r.text();
  console.log(`\n=== ${method} ${path} -> ${r.status}`);
  console.log(t.length > 20000 ? t.slice(0, 20000) + "\n...[truncated]" : t);
}

await hit("GET", "/health");
if (admin) {
  await hit("GET", "/api/admin/diag");
  await hit("GET", "/api/admin/odoo/probe");
  if (process.env.WRITE_PROBE === "1") await hit("POST", "/api/admin/odoo/probe-write?confirm=yes");
} else {
  console.log("\n(ADMIN_TOKEN not set: skipping admin diag + Odoo probe)");
}
