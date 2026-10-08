#!/usr/bin/env node
// Unit test plan (end to end) against the live Worker + Odoo.
//   node scripts/unittest.mjs <phase>   phases: create | register | checkin | verify | archive | all
// State + JSON proof go to $OUT_DIR (default /workspace/pj-unittest). Secrets are read from files and never printed.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const base = (process.env.BASE_URL || "https://events-patronjourney.message-0ad.workers.dev").replace(/\/+$/, "");
const SITE = (process.env.SITE_URL || "https://www.patronjourney.com").replace(/\/+$/, "");
const OUT = process.env.OUT_DIR || "/workspace/pj-unittest";
const CFG = process.env.PJ_CONFIG_DIR || `${homedir()}/.config/pj-organizer`;
mkdirSync(OUT, { recursive: true });
const secret = (n) => process.env[n] || readFileSync(`${CFG}/${n}`, "utf8").trim();
const ADMIN = secret("ADMIN_TOKEN");
const PIN = secret("TEST_ORGANIZER_PIN");
const ORG_EMAIL = "organizer+test@pjrny.com";
const ATTENDEES = [
  { key: "attendee1", name: "Attendee1 Test", email: "attendee1+test@pjrny.com" },
  { key: "attendee2", name: "Attendee2 Test", email: "attendee2+test@pjrny.com" },
  { key: "attendee3", name: "Attendee3 Test", email: "attendee3+test@pjrny.com" },
];
const statePath = `${OUT}/state.json`;
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const proof = (name, data) => writeFileSync(`${OUT}/${name}.json`, JSON.stringify(data, null, 2));
const redact = (o) => JSON.parse(JSON.stringify(o, (k, v) => (["token", "link", "pin"].includes(k) && typeof v === "string" ? "[redacted]" : v)));
const results = state.results || (state.results = []);
function check(step, name, ok, info) {
  const i = results.findIndex((r) => r.step === step && r.name === name);
  const row = { step, name, ok: !!ok, at: new Date().toISOString() };
  if (i >= 0) results[i] = row; else results.push(row);
  console.log(`${ok ? "PASS" : "FAIL"}  [${step}] ${name}${info !== undefined ? "  " + JSON.stringify(redact(info)) : ""}`);
  save();
  return !!ok;
}
async function call(method, path, { body, auth } = {}) {
  const h = {};
  if (auth) h.authorization = `Bearer ${auth}`;
  if (body !== undefined) h["content-type"] = "application/json";
  const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t.slice(0, 500); }
  return { status: r.status, data: d };
}
const odooRead = async (model, method, args) => (await call("POST", "/api/admin/odoo/read", { auth: ADMIN, body: { model, method, ...args } })).data;

async function login() {
  const r = await call("POST", "/api/auth/pin", { body: { email: ORG_EMAIL, pin: PIN } });
  check("a", "PIN login as organizer+test@pjrny.com issues JWT", r.status === 200 && r.data.token, { status: r.status, organizer: r.data.organizer, expires_at: r.data.expires_at });
  if (!r.data.token) throw new Error("login failed");
  return r.data.token;
}

async function phaseCreate(jwt) {
  if (state.event_id) { console.log(`event already created: ${state.event_id}`); return; }
  const body = {
    name: "Patron Journey Test Festival",
    description: "Organizer platform unit test event (Patron Journey). Safe to ignore; it will be archived after the test.",
    tags: ["Festival"],
    start: "2026-11-14T17:00", end: "2026-11-14T22:00", timezone: "America/Chicago",
    website_id: 1, capacity: 100,
    venue: { name: "Houston Test Venue", street: "1 Test St", city: "Houston", state: "TX", zip: "77002", country: "US" },
    tickets: { pay_at_door: true, volunteer: true, staff: true },
    speaker: { name: "Main Artist", start: "2026-11-14T18:00", end: "2026-11-14T19:00" },
    publish: true,
  };
  const r = await call("POST", "/api/organizer/events", { auth: jwt, body });
  proof("b-create-response", redact(r));
  const e = r.data.event || {};
  state.event_id = r.data.odoo_event_id;
  state.public_url = e.public_url;
  state.register_url = e.public_url ? `${e.public_url.replace(/\/+$/, "")}/register` : null;
  state.backend_url = e.odoo_backend_url;
  state.tickets = e.tickets;
  save();
  check("b", "create event (201)", r.status === 201 && state.event_id, { status: r.status, odoo_event_id: state.event_id, error: r.data.message, warnings: r.data.warnings });
  if (!state.event_id) return;
  check("b", "event published on website", e.website_published === true, { website_published: e.website_published, public_url: e.public_url });
  check("b", "capacity 100", e.seats_limited && e.seats_max === 100, { seats_max: e.seats_max });
  check("b", "venue = Houston Test Venue (reuses contact 37265)", Array.isArray(e.address_id) && e.address_id[0] === 37265, { address_id: e.address_id, venue: r.data.venue });
  const own = await call("GET", `/api/admin/ownership?odoo_event_id=${state.event_id}`, { auth: ADMIN });
  check("b", "D1 ownership row -> organizer+test", own.data.ownership?.length === 1 && own.data.ownership[0].email === ORG_EMAIL, own.data.ownership);
  check("b", "track 'Main Artist' 6-7 PM", (e.tracks || []).some((t) => t.partner_name === "Main Artist" && t.duration === 1), e.tracks);
  check("b", "Patron Journey sponsor", (e.sponsors || []).some((s) => s.partner_id?.[0] === 20), e.sponsors);
  const page = await fetch(state.public_url, { redirect: "follow" });
  const html = await page.text();
  check("b", "public event page reachable anonymously", page.status === 200 && html.includes("Patron Journey Test Festival"), { status: page.status, url: state.public_url });
}

// ---- native website registration (anonymous visitor per attendee) ----
class Jar {
  constructor() { this.c = new Map(); }
  take(res) { for (const sc of res.headers.getSetCookie?.() || []) { const [kv] = sc.split(";"); const i = kv.indexOf("="); this.c.set(kv.slice(0, i).trim(), kv.slice(i + 1)); } }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
}
const UA = "Mozilla/5.0 (X11; Linux x86_64) PatronJourneyOrganizerUnitTest/1.0";
async function site(jar, method, url, { body, headers = {} } = {}) {
  const res = await fetch(url.startsWith("http") ? url : SITE + url, { method, headers: { "user-agent": UA, cookie: jar.header(), ...headers }, body, redirect: "manual" });
  jar.take(res);
  return res;
}
async function registerOnWebsite(att, gaTicketId) {
  const jar = new Jar();
  const path = new URL(state.register_url).pathname; // /event/<slug>/register
  const evPath = path.replace(/\/register$/, "");
  const g = await site(jar, "GET", path);
  const page = await g.text();
  const csrf = /csrf_token\s*[:=]\s*["']([^"']+)["']/.exec(page)?.[1] || /name="csrf_token"\s+value="([^"]+)"/.exec(page)?.[1];
  const hasRecaptcha = /recaptcha|turnstile/i.test(page);
  // Step 2 (what the ticket modal does): JSON-RPC registration/new renders the attendee form.
  const nr = await site(jar, "POST", `${evPath}/registration/new`, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { [`nb_register-${gaTicketId}`]: 1 } }),
  });
  const nrj = await nr.json().catch(() => ({}));
  const formHtml = typeof nrj.result === "string" ? nrj.result : "";
  const inputNames = [...formHtml.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  // Step 3: POST the attendee form exactly as the browser would.
  const fd = new URLSearchParams();
  fd.set("csrf_token", /name="csrf_token"\s+value="([^"]+)"/.exec(formHtml)?.[1] || csrf || "");
  for (const n of inputNames) {
    if (n === "csrf_token") continue;
    if (/^1-name(-\d+)?$/.test(n)) fd.set(n, att.name);
    else if (/^1-email(-\d+)?$/.test(n)) fd.set(n, att.email);
    else if (/^1-phone(-\d+)?$/.test(n)) fd.set(n, "");
    else if (n === "1-event_ticket_id") fd.set(n, String(gaTicketId));
  }
  if (!fd.has("1-event_ticket_id")) fd.set("1-event_ticket_id", String(gaTicketId));
  if (![...fd.keys()].some((k) => k.startsWith("1-name"))) fd.set("1-name", att.name);
  if (![...fd.keys()].some((k) => k.startsWith("1-email"))) fd.set("1-email", att.email);
  const c = await site(jar, "POST", `${evPath}/registration/confirm`, { headers: { "content-type": "application/x-www-form-urlencoded" }, body: fd.toString() });
  const loc = c.headers.get("location") || "";
  const ids = /registration_ids=([\d%2C,]+)/.exec(loc)?.[1]?.replace(/%2C/gi, ",");
  let successOk = false;
  if (loc.includes("/registration/success")) {
    const s = await site(jar, "GET", loc);
    const sh = await s.text();
    successOk = s.status === 200 && /Registration confirmed|registration is confirmed|Thank you|confirmed/i.test(sh);
  }
  return { method: "website_form", get_status: g.status, csrf_found: !!csrf, recaptcha_or_turnstile_markup: hasRecaptcha, new_status: nr.status, new_rpc_error: nrj.error?.data?.message || nrj.error?.message || null,
    form_fields: inputNames.filter((n) => n !== "csrf_token"), confirm_status: c.status, confirm_location: loc, registration_ids: ids ? ids.split(",").map(Number) : [], success_page_ok: successOk };
}

async function phaseRegister(jwt) {
  if (!state.event_id) throw new Error("run create first");
  const ga = (state.tickets || []).find((t) => t.name === "General Admission");
  state.registration = state.registration || {};
  for (const att of ATTENDEES) {
    if (state.registration[att.key]?.registration_ids?.length) { console.log(`${att.key} already registered`); continue; }
    let r;
    try { r = await registerOnWebsite(att, ga.id); } catch (e) { r = { method: "website_form", error: String(e?.message || e) }; }
    state.registration[att.key] = r; save();
    check("c", `${att.email} registered via native website form`, r.registration_ids?.length === 1, r);
  }
  proof("c-website-registration", state.registration);
  const a = await call("GET", `/api/organizer/events/${state.event_id}/attendees`, { auth: jwt });
  proof("c-attendees-after-registration", a.data);
  state.barcodes = {};
  for (const att of ATTENDEES) {
    const row = (a.data.attendees || []).find((x) => (x.email || "").toLowerCase() === att.email);
    state.barcodes[att.key] = row?.barcode || null;
    check("c", `${att.email} registration in Odoo (state open) + barcode`, row && row.state === "open" && row.barcode, row && { registration_id: row.registration_id, state: row.state, ticket: row.ticket, barcode: row.barcode, partner_id: row.partner_id });
  }
  save();
}

async function phaseMail() {
  // Confirmation/ticket mail: event.mail "after registration" scheduler -> mail.mail / mail.message on each registration.
  const regIds = Object.values(state.registration || {}).flatMap((r) => r.registration_ids || []);
  const sched = await odooRead("event.mail", "search_read", { domain: [["event_id", "=", state.event_id]], fields: ["id", "interval_type", "interval_nbr", "interval_unit", "template_ref", "mail_done", "mail_count_done", "scheduled_date", "mail_state"] });
  const msgs = await odooRead("mail.message", "search_read", { domain: [["model", "=", "event.registration"], ["res_id", "in", regIds], ["message_type", "in", ["email", "email_outgoing", "notification", "comment"]]], fields: ["id", "res_id", "subject", "message_type", "date", "partner_ids"], order: "id asc" });
  const mails = await odooRead("mail.mail", "search_read", { domain: [["model", "=", "event.registration"], ["res_id", "in", regIds]], fields: ["id", "res_id", "subject", "state", "email_to", "failure_reason"], context: { active_test: false } });
  const emr = await odooRead("event.mail.registration", "search_read", { domain: [["registration_id", "in", regIds]], fields: ["id", "registration_id", "scheduler_id", "mail_sent", "scheduled_date"] });
  const out = { registration_ids: regIds, schedulers: sched.result ?? sched, mail_messages: msgs.result ?? msgs, mail_mail: mails.result ?? mails, event_mail_registration: emr.result ?? emr };
  proof("c-confirmation-mail", out);
  const sentPerReg = new Map();
  for (const m of out.mail_messages || []) if (/(regist|ticket|confirm)/i.test(m.subject || "")) sentPerReg.set(m.res_id, m);
  for (const r of out.event_mail_registration || []) if (r.mail_sent) sentPerReg.set(r.registration_id[0] ?? r.registration_id, sentPerReg.get(r.registration_id[0] ?? r.registration_id) || { via: "event.mail.registration" });
  check("c", "confirmation/ticket email sent for all 3 registrations (Odoo mail scheduler)", regIds.length === 3 && regIds.every((id) => sentPerReg.has(id)), { sent_for: [...sentPerReg.keys()], schedulers: (out.schedulers || []).map?.((s) => ({ id: s.id, type: s.interval_type, done: s.mail_done, count: s.mail_count_done, state: s.mail_state })) });
}

async function phaseCheckin(jwt) {
  const b = state.barcodes || {};
  const scan = async (label, code) => {
    const r = await call("POST", `/api/organizer/events/${state.event_id}/checkin`, { auth: jwt, body: { barcode: code } });
    (state.scans ||= []).push({ label, http: r.status, result: r.data.result, message: r.data.message, method: r.data.method, attendee: r.data.attendee?.email, barcode: code });
    save();
    return r;
  };
  state.scans = [];
  const s1 = await scan("attendee1 first scan", b.attendee1);
  check("d", "scan attendee1 -> Checked In", s1.data.result === "checked_in" && s1.data.message === "Checked In" && s1.data.attendee?.state === "done", { http: s1.status, result: s1.data.result, method: s1.data.method });
  const s2 = await scan("attendee1 second scan", b.attendee1);
  check("d", "scan attendee1 again -> Already Checked In", s2.data.result === "already_checked_in" && s2.data.message === "Already Checked In", { http: s2.status, result: s2.data.result });
  const s3 = await scan("attendee2 first scan", b.attendee2);
  check("d", "scan attendee2 -> Checked In", s3.data.result === "checked_in" && s3.data.attendee?.state === "done", { http: s3.status, result: s3.data.result, method: s3.data.method });
  const s4 = await scan("bogus barcode", "1234567890123456789");
  check("d", "unknown barcode -> Invalid Ticket", s4.data.result === "invalid_ticket" && s4.data.message === "Invalid Ticket", { http: s4.status, result: s4.data.result });
  const foreign = await call("POST", `/api/organizer/events/14/checkin`, { auth: jwt, body: { barcode: b.attendee3 } });
  check("d", "check-in on an event the organizer does not own -> 403", foreign.status === 403, foreign.status);
  const noJwt = await call("POST", `/api/organizer/events/${state.event_id}/checkin`, { body: { barcode: b.attendee3 } });
  check("d", "check-in without JWT -> 401", noJwt.status === 401, noJwt.status);
  proof("d-scans", state.scans);
}

async function phaseVerify(jwt) {
  const a = await call("GET", `/api/organizer/events/${state.event_id}/attendees`, { auth: jwt });
  proof("e-final-attendees", a.data);
  const c = a.data.counts || {};
  check("e", "final: 3 registered", c.registered === 3, c);
  check("e", "final: 2 checked in", c.checked_in === 2, c);
  check("e", "final: 1 pending (attendee3)", c.pending === 1 && (a.data.attendees || []).find((x) => x.email === "attendee3+test@pjrny.com")?.state === "open", c);
  const od = await odooRead("event.registration", "search_read", { domain: [["event_id", "=", state.event_id]], fields: ["id", "email", "state", "date_closed", "barcode", "event_ticket_id"], order: "id asc" });
  proof("e-odoo-registrations", od);
  const aud = await call("GET", `/api/admin/audit?limit=60`, { auth: ADMIN });
  const scansAudit = (aud.data.audit || []).filter((r) => r.odoo_event_id === state.event_id && String(r.action).startsWith("checkin."));
  proof("e-audit-checkins", scansAudit);
  check("e", "every scan attempt audited (>= 4 checkin.* rows)", scansAudit.length >= 4, scansAudit.map((r) => r.action));
  const page = await (await fetch(`${base}/dashboard/checkin`)).text();
  check("e", "GET /dashboard/checkin serves scanner page", page.includes("Check-In Scanner") && page.includes("html5-qrcode"));
}

async function phaseArchive(jwt) {
  const ar = await call("POST", `/api/organizer/events/${state.event_id}/archive`, { auth: jwt, body: {} });
  const od = await odooRead("event.event", "search_read", { domain: [["id", "=", state.event_id]], fields: ["active", "website_published"], context: { active_test: false } });
  const ev = od.result?.[0];
  state.archived = ev; save();
  proof("f-archive", { http: ar.status, response: ar.data, odoo: ev });
  check("f", "test event archived in Odoo (active=false, not deleted)", ar.status === 200 && ev && ev.active === false, ev);
  check("f", "archived event is unpublished", ev && ev.website_published === false, ev);
  const pub = await fetch(state.public_url, { redirect: "manual" });
  check("f", "public page no longer serves the event", pub.status !== 200, pub.status);
}

const phase = process.argv[2] || "all";
const jwt = await login();
if (["create", "all"].includes(phase)) await phaseCreate(jwt);
if (["register", "all"].includes(phase)) await phaseRegister(jwt);
if (["mail", "register", "all"].includes(phase)) await phaseMail();
if (["checkin", "all"].includes(phase)) await phaseCheckin(jwt);
if (["verify", "checkin", "all"].includes(phase)) await phaseVerify(jwt);
if (["archive", "all"].includes(phase)) await phaseArchive(jwt);
await call("POST", "/api/auth/logout", { auth: jwt });
proof("results", { event_id: state.event_id, public_url: state.public_url, register_url: state.register_url, results: state.results });
const failed = (state.results || []).filter((r) => !r.ok);
console.log(`\n${state.results.length - failed.length}/${state.results.length} passed so far`);
