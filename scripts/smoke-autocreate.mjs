#!/usr/bin/env node
// Smoke: organizer auto-create on first verified magic-link sign-in for pjrny.com (Odoo) users.
//
//   ADMIN_TOKEN_FILE=~/.config/pj-organizer/ADMIN_TOKEN TEST_ORGANIZER_PIN_FILE=~/.config/pj-organizer/TEST_ORGANIZER_PIN \
//   NEW_ORGANIZER_EMAIL=attendee1+test@pjrny.com node scripts/smoke-autocreate.mjs
//
// NEW_ORGANIZER_EMAIL must be an Odoo portal user that is NOT yet an organizer in D1.
// SEND_REAL_EMAIL=1 also requests a real first-time sign-in email through Odoo (to NEW_ORGANIZER_EMAIL).
// Nothing secret is printed (tokens/links are redacted).
import { readFileSync } from "node:fs";

const base = (process.env.BASE_URL || "https://events-patronjourney.message-0ad.workers.dev").replace(/\/+$/, "");
const readSecret = (envName, fileEnv) => process.env[envName] || (process.env[fileEnv] ? readFileSync(process.env[fileEnv], "utf8").trim() : "");
const admin = readSecret("ADMIN_TOKEN", "ADMIN_TOKEN_FILE");
const pin = readSecret("TEST_ORGANIZER_PIN", "TEST_ORGANIZER_PIN_FILE");
const NEW = (process.env.NEW_ORGANIZER_EMAIL || "attendee1+test@pjrny.com").toLowerCase();
const EXISTING = process.env.ORGANIZER_EMAIL || "organizer+test@pjrny.com";
const UNKNOWN = `no-odoo-account-${Date.now()}@example.com`;
if (!admin || !pin) throw new Error("ADMIN_TOKEN(_FILE) and TEST_ORGANIZER_PIN(_FILE) are required");

const results = [];
const redact = (o) => JSON.parse(JSON.stringify(o ?? null, (k, v) => (["token", "link"].includes(k) && typeof v === "string" ? "[redacted]" : v)));
async function call(method, path, { body, auth, cookie, form } = {}) {
  const h = {};
  if (auth) h.authorization = `Bearer ${auth}`;
  if (cookie) h.cookie = cookie;
  let payload;
  if (form) payload = new URLSearchParams(form);
  else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(base + path, { method, headers: h, body: payload, redirect: "manual" });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t.slice(0, 200); }
  return { status: r.status, data: d, headers: r.headers };
}
function check(name, ok, info) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info !== undefined ? "  " + JSON.stringify(redact(info)) : ""}`);
}
const lookup = (email) => call("GET", `/api/admin/odoo-account?email=${encodeURIComponent(email)}`, { auth: admin });

const h = await call("GET", "/health");
check("health", h.status === 200 && h.data.ok, { version: h.data.version });

// ---- Unknown email (no Odoo account) is never auto-created ----
const u0 = await lookup(UNKNOWN);
check("unknown email: no Odoo account, no organizer", u0.data.odoo_account === null && u0.data.organizer === null, { email: UNKNOWN });
const um = await call("POST", "/api/auth/magic-link", { body: { email: UNKNOWN } });
check("unknown email: magic-link request -> 404 signup_required", um.status === 404 && um.data.error === "signup_required", { status: um.status, error: um.data.error, message: um.data.message });
const up = await call("POST", "/api/auth/pin", { body: { email: UNKNOWN, pin: "12345678" } });
check("unknown email: PIN login -> 404 signup_required", up.status === 404 && up.data.error === "signup_required", { status: up.status, error: up.data.error });
const ua = await call("POST", "/api/admin/organizers/magic-link", { auth: admin, body: { email: UNKNOWN } });
check("unknown email: admin mint refused", ua.status === 404 && ua.data.error === "signup_required", ua.status);
const u1 = await lookup(UNKNOWN);
check("unknown email: still no organizer row", u1.data.organizer === null);

// ---- Real pjrny portal user, not yet an organizer ----
const n0 = await lookup(NEW);
check(`${NEW}: is an Odoo user and not yet an organizer`, n0.data.odoo_account && n0.data.organizer === null, { odoo_account: n0.data.odoo_account, organizer: n0.data.organizer });
if (!n0.data.odoo_account || n0.data.organizer) { console.log("Pick another NEW_ORGANIZER_EMAIL."); process.exit(1); }
const np = await call("POST", "/api/auth/pin", { body: { email: NEW, pin } });
check("first-time PIN login -> 409 pin_not_set (must use email link first)", np.status === 409 && np.data.error === "pin_not_set", { status: np.status, message: np.data.message });

if (process.env.SEND_REAL_EMAIL === "1") {
  const rm = await call("POST", "/api/auth/magic-link", { body: { email: NEW } });
  const aud = await call("GET", "/api/admin/audit?limit=10", { auth: admin });
  const row = (aud.data.audit || []).find((r) => r.action === "auth.signup_link_sent");
  const det = row ? JSON.parse(row.detail || "{}") : {};
  check("real first-time sign-in email queued/sent via Odoo mail.mail", rm.status === 200 && rm.data.first_time === true && row?.odoo_id, { status: rm.status, first_time: rm.data.first_time, message: rm.data.message, mail_id: row?.odoo_id, mail_status: det.mail_status });
  const n1 = await lookup(NEW);
  check("requesting a link does NOT create the organizer (only verify does)", n1.data.organizer === null);
}

const mint = await call("POST", "/api/admin/organizers/magic-link", { auth: admin, body: { email: NEW } });
check("admin mint -> pending onboarding link", mint.status === 200 && mint.data.pending_signup === true, { pending_signup: mint.data.pending_signup, odoo_account: mint.data.odoo_account });
const n2 = await lookup(NEW);
check("still no organizer before verify", n2.data.organizer === null);
const tok = new URL(mint.data.link).searchParams.get("token");
const page = await fetch(mint.data.link);
check("GET /auth/magic confirm page (does not consume)", page.status === 200);
const mv = await call("POST", "/auth/magic", { form: { token: tok } });
const setCookie = mv.headers.get("set-cookie") || "";
check("POST /auth/magic -> 303 + session cookie", mv.status === 303 && setCookie.includes("pj_session="), mv.status);
const jwt = (/pj_session=([^;]+)/.exec(setCookie) || [])[1];
const n3 = await lookup(NEW);
const org = n3.data.organizer;
check("organizer row auto-created with Odoo partner + user", org && org.active === 1 && org.role === "organizer" && org.odoo_partner_id === n0.data.odoo_account.partner_id && org.odoo_user_id === n0.data.odoo_account.user_id && !org.pin_set, org);
const aud2 = await call("GET", "/api/admin/audit?limit=15", { auth: admin });
const ac = (aud2.data.audit || []).find((r) => r.action === "organizer.auto_created" && r.organizer_id === org?.id);
check("audit organizer.auto_created", !!ac, ac && { id: ac.id, action: ac.action, organizer_id: ac.organizer_id, odoo_model: ac.odoo_model, odoo_id: ac.odoo_id, detail: JSON.parse(ac.detail || "{}"), created_at_utc: ac.created_at });
const replay = await call("POST", "/api/auth/magic/verify", { body: { token: tok } });
check("onboarding link is single-use", replay.status === 401, replay.status);

const me = await call("GET", "/api/auth/me", { auth: jwt });
check("/api/auth/me works, pin_set=false", me.status === 200 && me.data.organizer?.email === NEW && me.data.organizer?.pin_set === false, me.data.organizer);
const evs = await call("GET", "/api/organizer/events", { auth: jwt });
check("new organizer sees no events", evs.status === 200 && (evs.data.events || []).length === 0, (evs.data.events || []).length);
const foreign = await call("GET", "/api/organizer/events/14", { auth: jwt });
check("ownership gate: Testival -> 403", foreign.status === 403, foreign.status);

const ps = await call("POST", "/api/organizer/pin", { auth: jwt, body: { pin } });
check("set PIN after first magic-link sign-in", ps.status === 200, ps.status);
const pl = await call("POST", "/api/auth/pin", { body: { email: NEW, pin } });
check("PIN login now works", pl.status === 200 && pl.data.token && pl.data.organizer?.pin_set === true, pl.data.organizer);

const mint2 = await call("POST", "/api/admin/organizers/magic-link", { auth: admin, body: { email: NEW } });
check("second link is a normal organizer link (no duplicate create)", mint2.status === 200 && !mint2.data.pending_signup, mint2.status);
const aud3 = await call("GET", "/api/admin/audit?limit=40", { auth: admin });
check("exactly one organizer.auto_created for this organizer", (aud3.data.audit || []).filter((r) => r.action === "organizer.auto_created" && r.organizer_id === org?.id).length === 1);

const ex = await call("POST", "/api/auth/pin", { body: { email: EXISTING, pin } });
check(`regression: existing organizer ${EXISTING} PIN login`, ex.status === 200 && ex.data.token, ex.status);

for (const t of [jwt, pl.data.token, ex.data.token]) if (t) await call("POST", "/api/auth/logout", { auth: t });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
