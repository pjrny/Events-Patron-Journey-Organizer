#!/usr/bin/env node
// Slice 2 smoke: health, diag, organizer seed, magic-link email via Odoo, magic-link verify, PIN login,
// create "Patron Journey Test Festival" (capacity 100, Houston Test Venue), verify D1 ownership + Odoo, archive.
//
//   BASE_URL=https://events-patronjourney.message-0ad.workers.dev \
//   ADMIN_TOKEN_FILE=~/.config/pj-organizer/ADMIN_TOKEN TEST_ORGANIZER_PIN_FILE=~/.config/pj-organizer/TEST_ORGANIZER_PIN \
//   node scripts/smoke-slice2.mjs            # add KEEP_EVENT=1 to leave the test event unarchived (still unpublished)
//
// Secrets are read from files/env and only sent to the Worker; nothing secret is printed.
import { readFileSync } from "node:fs";

const base = (process.env.BASE_URL || "https://events-patronjourney.message-0ad.workers.dev").replace(/\/+$/, "");
const readSecret = (envName, fileEnv) => process.env[envName] || (process.env[fileEnv] ? readFileSync(process.env[fileEnv], "utf8").trim() : "");
const admin = readSecret("ADMIN_TOKEN", "ADMIN_TOKEN_FILE");
const pin = readSecret("TEST_ORGANIZER_PIN", "TEST_ORGANIZER_PIN_FILE");
const EMAIL = process.env.ORGANIZER_EMAIL || "organizer+test@pjrny.com";
if (!admin || !pin) throw new Error("ADMIN_TOKEN(_FILE) and TEST_ORGANIZER_PIN(_FILE) are required");

const results = [];
const redact = (o) => JSON.parse(JSON.stringify(o, (k, v) => (["token", "link"].includes(k) && typeof v === "string" ? "[redacted]" : v)));
async function call(method, path, { body, headers = {}, auth, form, expect } = {}) {
  const h = { ...headers };
  if (auth) h.authorization = `Bearer ${auth}`;
  let payload;
  if (form) { payload = new URLSearchParams(form); }
  else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(base + path, { method, headers: h, body: payload, redirect: "manual" });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t.slice(0, 300); }
  return { status: r.status, data: d, headers: r.headers };
}
function check(name, ok, info) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info !== undefined ? "  " + JSON.stringify(redact(info)) : ""}`);
}

// 1. health + diag
const h = await call("GET", "/health");
check("health ok", h.status === 200 && h.data.ok && h.data.auth?.jwt_secret && h.data.auth?.pin_pepper, { version: h.data.version, auth: h.data.auth });
const dg = await call("GET", "/api/admin/diag", { auth: admin });
check("admin diag", dg.status === 200 && dg.data.secret_names?.includes("TEST_ORGANIZER_PIN"), { secret_names: dg.data.secret_names, d1: dg.data.d1_counts });

// 2. seed organizer + PIN
const seed = await call("POST", "/api/admin/organizers", { auth: admin, body: { email: EMAIL, pin_from_env: "TEST_ORGANIZER_PIN" } });
check("organizer seeded + linked to Odoo partner", seed.status === 200 && seed.data.organizer?.pin_set, seed.data);

// 3. unauthenticated organizer API is rejected
const unauth = await call("GET", "/api/organizer/events");
check("organizer API requires JWT", unauth.status === 401, unauth.status);

// 4. magic link email through Odoo mail.mail
const ml = await call("POST", "/api/auth/magic-link", { body: { email: EMAIL } });
const aud = await call("GET", "/api/admin/audit?limit=10", { auth: admin });
const mailRow = (aud.data.audit || []).find((r) => r.action === "auth.magic_link_sent");
const mailDetail = mailRow ? JSON.parse(mailRow.detail || "{}") : null;
check("magic link requested + mail.mail created in Odoo", ml.status === 200 && mailRow && mailRow.odoo_id, { http: ml.status, mail_id: mailRow?.odoo_id, ...mailDetail });

// 5. magic link verify path (admin-minted token, not emailed)
const minted = await call("POST", "/api/admin/organizers/magic-link", { auth: admin, body: { email: EMAIL } });
const page = await fetch(minted.data.link);
check("GET /auth/magic shows confirm page (does not consume)", page.status === 200);
const tok = new URL(minted.data.link).searchParams.get("token");
const mv = await call("POST", "/auth/magic", { form: { token: tok } });
check("POST /auth/magic -> 303 + session cookie", mv.status === 303 && (mv.headers.get("set-cookie") || "").includes("pj_session="), mv.status);
const replay = await call("POST", "/api/auth/magic/verify", { body: { token: tok } });
check("magic link is single-use", replay.status === 401, replay.status);

// 6. PIN login (wrong PIN, then right PIN)
const bad = await call("POST", "/api/auth/pin", { body: { email: EMAIL, pin: "00000000" } });
check("wrong PIN rejected", bad.status === 401, bad.status);
const login = await call("POST", "/api/auth/pin", { body: { email: EMAIL, pin } });
check("PIN login issues JWT", login.status === 200 && login.data.token, { organizer: login.data.organizer, expires_at: login.data.expires_at });
const jwt = login.data.token;
const me = await call("GET", "/api/auth/me", { auth: jwt });
check("/api/auth/me", me.status === 200 && me.data.organizer?.email === EMAIL, me.data.organizer);

// 7. create event
const createBody = {
  name: "Patron Journey Test Festival",
  description: "Organizer platform smoke test event. Safe to ignore.",
  tags: ["Festival"],
  start: "2026-11-14T17:00",
  end: "2026-11-14T22:00",
  timezone: "America/Chicago",
  website_id: 1,
  capacity: 100,
  venue: { name: "Houston Test Venue", street: "1 Test St", city: "Houston", state: "TX", zip: "77002", country: "US" },
  tickets: { pay_at_door: true, volunteer: true, staff: true },
  speaker: { name: "Main Artist", start: "2026-11-14T18:00", end: "2026-11-14T19:00" },
  publish: false,
  // 1x1 PNG
  image: { data_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhgHAj3r7WQAAAABJRU5ErkJggg==", mimetype: "image/png", filename: "smoke-cover.png" },
};
const cr = await call("POST", "/api/organizer/events", { auth: jwt, body: createBody });
const evId = cr.data.odoo_event_id;
check("create event", cr.status === 201 && evId, { status: cr.status, odoo_event_id: evId, error: cr.data.message, warnings: cr.data.warnings });
if (evId) {
  const e = cr.data.event || {};
  console.log(JSON.stringify(redact({ venue: cr.data.venue, tickets: cr.data.tickets, sponsor: cr.data.sponsor, track: cr.data.track, image: cr.data.image, summary: { name: e.name, local_start: e.local_start, local_end: e.local_end, date_tz: e.date_tz, seats_max: e.seats_max, website_id: e.website_id, company_id: e.company_id, address_id: e.address_id, website_published: e.website_published, tag_ids: e.tag_ids, organizer_id: e.organizer_id, tickets: e.tickets, tracks: e.tracks, sponsors: e.sponsors, regs: e.registrations_by_state, backend: e.odoo_backend_url } }), null, 2));

  const own = await call("GET", `/api/admin/ownership?odoo_event_id=${evId}`, { auth: admin });
  check("D1 ownership row", own.data.ownership?.length === 1 && own.data.ownership[0].email === EMAIL, own.data.ownership);

  const od = await call("POST", "/api/admin/odoo/read", { auth: admin, body: { model: "event.event", method: "search_read", domain: [["id", "=", evId]], fields: ["name", "seats_max", "address_id", "website_id", "website_published", "active"], context: { active_test: false } } });
  const ev = od.data.result?.[0];
  check("event exists in Odoo with capacity 100 + Houston Test Venue", ev && ev.seats_max === 100 && /Houston Test Venue/.test(ev.address_id?.[1] || ""), ev);
  const tk = e.tickets || [];
  check("tickets: GA + Pay At Door + Volunteer + Staff, all $0, cap 100, no VIP",
    ["General Admission", "Pay At Door", "Volunteer", "Staff"].every((n) => tk.some((t) => t.name === n)) && tk.length === 4 && tk.every((t) => t.price === 0 && t.seats_max === 100), tk.map((t) => t.name));
  check("Patron Journey sponsor present", (e.sponsors || []).some((s) => s.partner_id?.[0] === 20));
  check("Main Artist track 6-7 PM", (e.tracks || []).some((t) => t.partner_name === "Main Artist" && t.duration === 1));

  const other = await call("GET", `/api/organizer/events/999999`, { auth: jwt });
  check("ownership gate: foreign event -> 403", other.status === 403, other.status);
  const list = await call("GET", "/api/organizer/events", { auth: jwt });
  check("My Events lists it", (list.data.events || []).some((x) => x.odoo_event_id === evId));

  if (process.env.KEEP_EVENT !== "1") {
    const ar = await call("POST", `/api/organizer/events/${evId}/archive`, { auth: jwt, body: {} });
    const od2 = await call("POST", "/api/admin/odoo/read", { auth: admin, body: { model: "event.event", method: "search_read", domain: [["id", "=", evId]], fields: ["active"], context: { active_test: false } } });
    check("archived in Odoo (not deleted)", ar.status === 200 && od2.data.result?.[0]?.active === false, od2.data.result?.[0]);
  }
}

const lo = await call("POST", "/api/auth/logout", { auth: jwt });
const after = await call("GET", "/api/auth/me", { auth: jwt });
check("logout revokes session", lo.status === 200 && after.status === 401, after.status);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
