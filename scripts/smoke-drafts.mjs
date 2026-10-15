#!/usr/bin/env node
// Smoke: simulator link (event-draft.v1) end to end against the live Worker.
//   ADMIN_TOKEN_FILE=~/.config/pj-organizer/ADMIN_TOKEN TEST_ORGANIZER_PIN_FILE=~/.config/pj-organizer/TEST_ORGANIZER_PIN node scripts/smoke-drafts.mjs
// Creates 2 Odoo events (anonymous-claim path + signed-in path) for organizer+test@pjrny.com and ARCHIVES both.
// Nothing secret is printed (tokens, cookies, claim tokens and links are redacted).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const base = (process.env.BASE_URL || "https://events-patronjourney.message-0ad.workers.dev").replace(/\/+$/, "");
const readSecret = (n, f) => process.env[n] || (process.env[f] ? readFileSync(process.env[f], "utf8").trim() : "");
const admin = readSecret("ADMIN_TOKEN", "ADMIN_TOKEN_FILE");
const pin = readSecret("TEST_ORGANIZER_PIN", "TEST_ORGANIZER_PIN_FILE");
const EMAIL = process.env.ORGANIZER_EMAIL || "organizer+test@pjrny.com";
if (!admin || !pin) throw new Error("ADMIN_TOKEN(_FILE) and TEST_ORGANIZER_PIN(_FILE) are required");

const results = [];
const archived = [];
const SECRET_KEYS = ["token", "link", "claim_token", "claim_url", "t"];
const redact = (o) => JSON.parse(JSON.stringify(o ?? null, (k, v) => (SECRET_KEYS.includes(k) && typeof v === "string" ? "[redacted]" : v)));
async function call(method, path, { body, auth, cookie, form, origin, raw } = {}) {
  const h = {};
  if (auth) h.authorization = `Bearer ${auth}`;
  if (cookie) h.cookie = cookie;
  if (origin) h.origin = origin;
  let payload;
  if (form) payload = new URLSearchParams(form);
  else if (raw !== undefined) { h["content-type"] = "application/json"; payload = raw; }
  else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(base + path, { method, headers: h, body: payload, redirect: "manual" });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d, headers: r.headers };
}
function check(name, ok, info) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info !== undefined ? "  " + JSON.stringify(redact(info)) : ""}`);
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const draft = (name) => ({
  version: "event-draft.v1",
  name,
  start: "2026-12-12T17:00",
  end: "2026-12-12T23:30",
  timezone: "America/Chicago",
  venue: { name: "Smoke Test Hall", street: "100 Main St", city: "Houston", state: "TX", zip: "77002" },
  capacity: 500,
  description: "Created by scripts/smoke-drafts.mjs. Archived automatically.",
  tags: ["Festival", "EDM", "Smoke Test"],
  tickets: [{ name: "GA – Pay at Door $199", price: 199, max: 500 }, { name: "VIP – Pay at Door $299", price: 299, max: 50 }],
  lineup: [{ name: "Opener DJ", start: "2026-12-12T18:00", end: "2026-12-12T19:30" }, { name: "Headliner", start: "2026-12-12T21:00", end: "2026-12-12T23:00" }],
  forecast: { ga_price: 199, attendance_p50: 420, net_p50: 12345.67, note: "opaque, never sent to Odoo" },
});

const h = await call("GET", "/health");
check("health", h.status === 200 && h.data.ok, { version: h.data.version });

// ---------- CORS ----------
const pre = await call("OPTIONS", "/api/drafts", { origin: "https://www.pjrny.com" });
check("CORS preflight from www.pjrny.com allowed", pre.status === 204 && pre.headers.get("access-control-allow-origin") === "https://www.pjrny.com", pre.status);
const evil = await call("POST", "/api/drafts", { origin: "https://evil.example", body: draft("x") });
check("POST /api/drafts from other origin -> 403", evil.status === 403 && !evil.headers.get("access-control-allow-origin"), evil.status);
const orgCors = await call("OPTIONS", "/api/organizer/drafts", { origin: "https://www.pjrny.com" });
check("organizer API sends no CORS headers", !orgCors.headers.get("access-control-allow-origin"), orgCors.status);

// ---------- Validation ----------
const v1 = await call("POST", "/api/drafts", { origin: "https://pjrny.com", body: { ...draft("x"), name: "" } });
check("missing name -> 400 invalid_draft", v1.status === 400 && v1.data.error === "invalid_draft", v1.data.message);
const v2 = await call("POST", "/api/drafts", { body: { ...draft("x"), organizer_email: "someone@example.com" } });
check("owner field in payload -> 400", v2.status === 400 && /owner/.test(v2.data.message), v2.data.message);
const v3 = await call("POST", "/api/drafts", { body: { ...draft("x"), end: "2026-12-12T16:00" } });
check("end before start -> 400", v3.status === 400 && v3.data.error === "invalid_draft", v3.data.message);
const v4 = await call("POST", "/api/drafts", { body: { ...draft("x"), lineup: [{ name: "Late", start: "2026-12-13T01:00", end: "2026-12-13T02:00" }] } });
check("lineup outside event -> 400", v4.status === 400, v4.data.message);
const v5 = await call("POST", "/api/drafts", { body: { ...draft("x"), version: "v0" } });
check("wrong version -> 400", v5.status === 400, v5.data.message);
const v6 = await call("POST", "/api/drafts", { raw: JSON.stringify({ ...draft("x"), description: "x".repeat(1100000) }) });
check("> 1 MB -> 413", v6.status === 413, v6.status);

// ---------- Anonymous draft ----------
const a = await call("POST", "/api/drafts", { origin: "https://www.pjrny.com", body: draft(`Smoke Draft Anon ${stamp}`) });
check("anonymous draft saved -> 201 {draft_id, claim_token}", a.status === 201 && /^drf_/.test(a.data.draft_id) && a.data.claim_token && a.headers.get("access-control-allow-origin") === "https://www.pjrny.com", { draft_id: a.data.draft_id, expires_at: a.data.expires_at });
const D = a.data.draft_id, T = a.data.claim_token;

// invalid / expired tokens
const bad1 = await call("POST", "/api/auth/magic-link", { body: { email: EMAIL, draft: D, t: "wrong-token" } });
check("magic-link with wrong claim token -> 404 invalid_claim", bad1.status === 404 && bad1.data.error === "invalid_claim", bad1.status);
const pg = await fetch(`${base}/claim?draft=${D}&t=wrong`); const pgt = await pg.text();
check("GET /claim with wrong token shows error", pg.status === 200 && pgt.includes("This draft link is invalid"));
const pg2 = await fetch(`${base}/claim?draft=${D}&t=${encodeURIComponent(T)}`); const pg2t = await pg2.text();
check("GET /claim signed out shows sign-in + pjrny.com signup steps", pg2.status === 200 && pg2t.includes("pjrny.com/web/signup") && pg2t.includes("Create free event (pay at door)") && pg2t.includes("https://www.pjrny.com/#Contact-us"));
const e = await call("POST", "/api/drafts", { body: draft(`Smoke Draft Expire ${stamp}`) });
await call("POST", "/api/admin/drafts/expire", { auth: admin, body: { draft_id: e.data.draft_id } });
const ex = await call("POST", "/api/auth/magic-link", { body: { email: EMAIL, draft: e.data.draft_id, t: e.data.claim_token } });
check("expired anonymous draft -> 410 expired", ex.status === 410 && ex.data.error === "expired", ex.data.message);

// claim through the sign-in link row (no cookies carry the draft)
const mint = await call("POST", "/api/admin/organizers/magic-link", { auth: admin, body: { email: EMAIL, draft: D, t: T } });
check("sign-in link minted carrying the draft", mint.status === 200 && mint.data.token);
const mv = await call("POST", "/auth/magic", { form: { token: mint.data.token } });
const loc = mv.headers.get("location") || "";
const cookie = (mv.headers.get("set-cookie") || "").split(";")[0];
check("verify -> 303 back to /claim?draft=… with session", mv.status === 303 && loc === `/claim?draft=${D}` && cookie.startsWith("pj_session="), { status: mv.status, location: loc });
const gd = await call("GET", `/api/organizer/drafts/${D}`, { cookie });
check("draft now owned by organizer (forecast stored)", gd.status === 200 && gd.data.payload?.forecast?.net_p50 === 12345.67 && gd.data.claimed_at, { status: gd.status, claimed_at: gd.data.claimed_at });
const reuse = await call("POST", "/api/auth/magic-link", { body: { email: EMAIL, draft: D, t: T } });
check("claim token cannot be reused after claim -> 404", reuse.status === 404 && reuse.data.error === "invalid_claim", reuse.status);
const noauth = await call("GET", `/api/organizer/drafts/${D}`);
check("draft read without sign-in -> 401", noauth.status === 401);
const csrf = await call("POST", `/api/organizer/drafts/${D}/create`, { cookie, origin: "https://evil.example", body: {} });
check("cookie create from other origin -> 403 csrf", csrf.status === 403, csrf.status);

const pl = await call("POST", "/api/auth/pin", { body: { email: EMAIL, pin } });
const jwt = pl.data.token;
check("PIN login (bearer for create)", pl.status === 200 && !!jwt);

async function verifyEvent(label, id, expectTracks = ["Opener DJ", "Headliner"]) {
  const s = await call("GET", `/api/organizer/events/${id}`, { auth: jwt });
  const ev = s.data.event || {};
  const names = (ev.tickets || []).map((t) => t.name);
  check(`${label}: Odoo name/tz/capacity/venue`, ev.date_tz === "America/Chicago" && ev.seats_max === 500 && ev.address_id?.[1]?.includes("Smoke Test Hall") && ev.local_start === "2026-12-12T17:00",
    { name: ev.name, date_tz: ev.date_tz, seats_max: ev.seats_max, venue: ev.address_id, local_start: ev.local_start, local_end: ev.local_end });
  check(`${label}: tickets GA + pay-at-door names kept, all $0, max=capacity`,
    names.includes("General Admission") && names.includes("GA – Pay at Door $199") && names.includes("VIP – Pay at Door $299") && ev.tickets.every((t) => t.price === 0 && t.seats_max === 500),
    ev.tickets?.map((t) => ({ name: t.name, price: t.price, seats_max: t.seats_max })));
  const tr = (ev.tracks || []).map((t) => t.partner_name || t.name);
  check(`${label}: lineup -> tracks ${JSON.stringify(expectTracks)}`, expectTracks.every((x) => tr.includes(x)) && ev.tracks.length === expectTracks.length, ev.tracks?.map((t) => ({ name: t.name, date_utc: t.date, duration: t.duration })));
  const tags = await call("POST", "/api/admin/odoo/read", { auth: admin, body: { model: "event.tag", method: "read", ids: ev.tag_ids || [], fields: ["name"] } });
  const tn = (tags.data.result || []).map((t) => t.name);
  check(`${label}: tags (auto-created where missing)`, ["Festival", "EDM", "Smoke Test"].every((x) => tn.includes(x)), tn);
  const raw = await call("POST", "/api/admin/odoo/read", { auth: admin, body: { model: "event.event", method: "read", ids: [id], fields: ["description"] } });
  check(`${label}: forecast not sent to Odoo`, !JSON.stringify(raw.data.result).includes("12345.67"));
  return ev;
}

// create (anonymous-claimed draft) + idempotency
const c1 = await call("POST", `/api/organizer/drafts/${D}/create`, { auth: jwt, body: {} });
check("create from claimed draft -> 201 {odoo_event_id, dashboard_url, public_url}", c1.status === 201 && c1.data.odoo_event_id && c1.data.dashboard_url?.includes("/dashboard"), { odoo_event_id: c1.data.odoo_event_id, dashboard_url: c1.data.dashboard_url, public_url: c1.data.public_url, warnings: c1.data.warnings });
const c2 = await call("POST", `/api/organizer/drafts/${D}/create`, { auth: jwt, body: {} });
check("create again is idempotent (same event, 200 reused)", c2.status === 200 && c2.data.reused && c2.data.odoo_event_id === c1.data.odoo_event_id, { status: c2.status, odoo_event_id: c2.data.odoo_event_id });
if (c1.data.odoo_event_id) await verifyEvent("anon-claim", c1.data.odoo_event_id);

// signed-in draft path
// Placeholder lineup rows (blank names) are skipped -> one default track named after the event.
const SIGNED_NAME = `Smoke Draft Signed-in ${stamp}`;
const s1 = await call("POST", "/api/organizer/drafts", { auth: jwt, body: { ...draft(SIGNED_NAME), lineup: [{ name: "", start: "", end: "" }, { name: "   " }] } });
check("signed-in draft saved -> 201 {draft_id}", s1.status === 201 && /^drf_/.test(s1.data.draft_id) && !s1.data.claim_token, s1.data);
const s2 = await call("GET", `/api/organizer/drafts/${s1.data.draft_id}`, { auth: jwt });
check("signed-in draft readable by owner", s2.status === 200 && s2.data.payload?.name?.startsWith("Smoke Draft Signed-in"));
const s3 = await call("POST", `/api/organizer/drafts/${s1.data.draft_id}/create`, { auth: jwt, body: {} });
check("create from signed-in draft -> 201", s3.status === 201 && s3.data.odoo_event_id, { odoo_event_id: s3.data.odoo_event_id, dashboard_url: s3.data.dashboard_url });
if (s3.data.odoo_event_id) await verifyEvent("signed-in (blank lineup)", s3.data.odoo_event_id, [SIGNED_NAME]);

// archive
for (const id of [c1.data.odoo_event_id, s3.data.odoo_event_id].filter(Boolean)) {
  const ar = await call("POST", `/api/organizer/events/${id}/archive`, { auth: jwt, body: {} });
  const chk = await call("POST", "/api/admin/odoo/read", { auth: admin, body: { model: "event.event", method: "search_read", domain: [["id", "=", id]], fields: ["active", "website_published"], context: { active_test: false } } });
  const r = chk.data.result?.[0];
  check(`event ${id} archived + unpublished`, ar.status === 200 && r && r.active === false && r.website_published === false, r);
  if (r && r.active === false) archived.push(id);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed; archived events: ${archived.join(", ")}`);
mkdirSync("docs/drafts-proof", { recursive: true });
writeFileSync("docs/drafts-proof/results.json", JSON.stringify({ at: new Date().toISOString(), base, passed, total: results.length, archived, results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
