// Minimal organizer dashboard (no build step). Talks to /api/auth/* and /api/organizer/* with the session cookie.
import type { Env } from "./env";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Organizers need a pjrny.com website account first. Links use target="_top" so they open in the full
// window (not inside the frame) when the dashboard is embedded on pjrny.com.
const PJ_SIGNUP_URL = "https://www.pjrny.com/web/signup";
const PJ_LOGIN_URL = "https://www.pjrny.com/web/login";
const accountSteps = (lead = "New organizer? Start here.") => `<div id="accountSteps" class="msg" style="background:#f4f1f8">
<b>${lead}</b>
<ol style="margin:.4rem 0 0;padding-left:1.3rem">
<li>First, create your account on pjrny.com: <a href="${PJ_SIGNUP_URL}" target="_top">sign up here</a>.
Already have one? <a href="${PJ_LOGIN_URL}" target="_top">Sign in on pjrny.com</a>.</li>
<li>Then come back to this page and sign in to the organizer dashboard with an email link or your email + PIN, using the same email address.</li>
</ol></div>`;

// Shared by every page. When embedded cross-site (pjrny.com -> workers.dev) some browsers (Safari, strict
// privacy modes) drop the third-party session cookie, so the JWT returned by PIN login is also kept in this
// frame's sessionStorage and sent as a Bearer token. Cookie auth keeps working wherever it is allowed.
const COMMON_JS = `
const PJ_TK = 'pj_token';
const pjToken = { get() { try { return sessionStorage.getItem(PJ_TK); } catch { return null; } },
  set(v) { try { v ? sessionStorage.setItem(PJ_TK, v) : sessionStorage.removeItem(PJ_TK); } catch {} } };
const PJ_FRAMED = (() => { try { return window.self !== window.top; } catch { return true; } })();
if (PJ_FRAMED) { const n = document.getElementById('framedNote'); if (n) n.classList.remove('hidden'); document.body.style.margin = '1rem auto'; }
async function pjFetch(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const t = pjToken.get(); if (t) headers.authorization = 'Bearer ' + t;
  const r = await fetch(path, { credentials: 'same-origin', ...opts, headers });
  if (r.status === 401 && t) pjToken.set(null);
  return r;
}
`;

export const shell = (env: Env, title: string, body: string, script = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | Patron Journey Organizer</title>
<style>
body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1d1d1f}
a{color:#6b3fa0}h1{font-size:1.6rem}fieldset{border:1px solid #ddd;border-radius:8px;margin:1rem 0;padding:1rem}
label{display:block;margin:.5rem 0 .2rem;font-weight:600;font-size:.9rem}input,textarea,select{width:100%;padding:.5rem;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;font:inherit}
.row{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}.chk label{display:inline;font-weight:400;margin-right:1rem}.chk input{width:auto}
button{background:#6b3fa0;color:#fff;border:0;border-radius:6px;padding:.6rem 1.1rem;font:inherit;cursor:pointer}button.secondary{background:#eee;color:#333}
.msg{padding:.6rem;border-radius:6px;margin:.6rem 0}.ok{background:#e9f7ef}.err{background:#fdecea}table{width:100%;border-collapse:collapse}td,th{padding:.4rem;border-bottom:1px solid #eee;text-align:left;font-size:.92rem}
nav a{margin-right:1rem}.hidden{display:none}
</style></head>
<body><h1>${esc(title)}</h1>
<div id="framedNote" class="msg hidden" style="background:#f4f1f8;font-size:.9rem">You're using the dashboard embedded on pjrny.com.
New organizers: first <a href="${PJ_SIGNUP_URL}" target="_top">create a pjrny.com account</a> or <a href="${PJ_LOGIN_URL}" target="_top">sign in on pjrny.com</a>, then return to this page.
Email sign-in links open in a new tab: after clicking one, come back and reload this page. If this panel still asks you to sign in, use email + PIN here
or <a href="${esc(env.PUBLIC_BASE_URL || "")}/dashboard" target="_blank" rel="noopener">open the dashboard in a new tab</a>.</div>
${body}
<hr><p><small>Free tier: free and pay-at-door tickets only. Paid tickets, POS, RFID, mobile apps and advanced attendance:
<a href="${esc(env.PAID_UPGRADE_URL)}" target="_top">contact Patron Journey</a>.</small></p>
<script>${COMMON_JS}${script}</script></body></html>`;

export function magicConfirmPage(env: Env, token: string): string {
  // GET does not consume the token (email link scanners pre-fetch links). The button POSTs it.
  return shell(env, "Sign in", `<form method="post" action="/auth/magic"><input type="hidden" name="token" value="${esc(token)}">
<p>Click to finish signing in to the Patron Journey organizer dashboard.</p><button type="submit">Sign in</button></form>
${accountSteps("Don't have an organizer account yet?")}`);
}

export function errorPage(env: Env, message: string): string {
  return shell(env, "Sign in", `<div class="msg err">${esc(message)}</div>${accountSteps("Don't have an organizer account yet?")}<p><a href="/dashboard">Back to sign in</a></p>`);
}

const DASH_JS = `
const $ = (id) => document.getElementById(id);
const show = (el, txt, ok) => { el.className = 'msg ' + (ok ? 'ok' : 'err'); el.textContent = txt; el.classList.remove('hidden'); };
async function api(path, opts = {}) {
  const r = await pjFetch(path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || ('HTTP ' + r.status));
  return d;
}
async function boot() {
  try { const me = await api('/api/auth/me'); $('who').textContent = me.organizer.email; $('app').classList.remove('hidden'); loadEvents(); }
  catch { $('login').classList.remove('hidden'); }
}
$('magicForm').onsubmit = async (e) => { e.preventDefault();
  try { await api('/api/auth/magic-link', { method: 'POST', body: JSON.stringify({ email: $('mEmail').value }) }); show($('loginMsg'), 'If that email belongs to an organizer, a sign-in link is on its way. It expires in 15 minutes.', true); }
  catch (err) { show($('loginMsg'), err.message, false); } };
$('pinForm').onsubmit = async (e) => { e.preventDefault();
  try { const d = await api('/api/auth/pin', { method: 'POST', body: JSON.stringify({ email: $('pEmail').value, pin: $('pPin').value }) }); pjToken.set(d.token); location.reload(); }
  catch (err) { show($('loginMsg'), err.message, false); } };
$('logout').onclick = async (e) => { e.preventDefault(); await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); pjToken.set(null); location.reload(); };
async function loadEvents() {
  const d = await api('/api/organizer/events'); const tb = $('events'); tb.innerHTML = '';
  for (const r of d.events) { const e = r.odoo || {}; const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + r.odoo_event_id + '</td><td></td><td>' + (e.local_start || '') + '</td><td>' + (e.seats_taken ?? 0) + ' / ' + (e.seats_max ?? '') + '</td><td>' + (r.status === 'archived' ? 'archived' : (e.website_published ? 'published' : 'draft')) + '</td><td></td>';
    tr.children[1].textContent = e.name || '(missing in Odoo)';
    if (r.status !== 'archived') { const b = document.createElement('button'); b.className = 'secondary'; b.textContent = e.website_published ? 'Unpublish' : 'Publish';
      b.onclick = async () => { await api('/api/organizer/events/' + r.odoo_event_id + '/publish', { method: 'POST', body: JSON.stringify({ published: !e.website_published }) }); loadEvents(); };
      tr.children[5].appendChild(b);
      const s = document.createElement('a'); s.href = '/dashboard/checkin?event=' + r.odoo_event_id; s.textContent = ' Check-in'; s.style.marginLeft = '.5rem'; tr.children[5].appendChild(s); }
    tb.appendChild(tr); }
}
const fileToB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
$('createForm').onsubmit = async (e) => { e.preventDefault(); const f = e.target; const v = (n) => f.elements[n].value.trim();
  const body = { name: v('name'), description: v('description'), tags: v('tag') ? [v('tag')] : [], start: v('start'), end: v('end'), timezone: v('timezone'),
    website_id: Number(v('website_id')), capacity: Number(v('capacity')),
    venue: v('venue_name') ? { name: v('venue_name'), street: v('street'), city: v('city'), state: v('state'), zip: v('zip'), country: v('country') || 'US' } : undefined,
    tickets: { pay_at_door: f.elements.pay_at_door.checked, volunteer: f.elements.volunteer.checked, staff: f.elements.staff.checked },
    speaker: v('speaker') ? { name: v('speaker'), start: v('sp_start') || undefined, end: v('sp_end') || undefined } : undefined,
    publish: f.elements.publish.checked };
  const img = f.elements.image.files[0]; if (img) body.image = { data_base64: await fileToB64(img), mimetype: img.type, filename: img.name };
  show($('createMsg'), 'Creating event in Odoo...', true);
  try { const d = await api('/api/organizer/events', { method: 'POST', body: JSON.stringify(body) });
    show($('createMsg'), 'Created event ' + d.odoo_event_id + (d.warnings && d.warnings.length ? ' (warnings: ' + d.warnings.join('; ') + ')' : ''), true); f.reset(); loadEvents(); }
  catch (err) { show($('createMsg'), err.message, false); } };
boot();
`;

export function dashboardPage(env: Env): string {
  return shell(env, "Organizer Dashboard", `
<section id="login" class="hidden">
  ${accountSteps()}
  <div id="loginMsg" class="msg hidden"></div>
  <fieldset><legend>Email me a sign-in link</legend><form id="magicForm"><label>Email</label><input id="mEmail" type="email" required autocomplete="email"><p><button>Send link</button></p></form></fieldset>
  <fieldset><legend>Or sign in with email + PIN</legend><form id="pinForm"><label>Email</label><input id="pEmail" type="email" required autocomplete="email"><label>PIN</label><input id="pPin" type="password" inputmode="numeric" required autocomplete="current-password"><p><button>Sign in</button></p></form></fieldset>
</section>
<section id="app" class="hidden">
  <p>Signed in as <b id="who"></b> &middot; <a href="#" id="logout">Sign out</a></p>
  <nav><a href="#my">My Events</a><a href="#create">Create Event</a><a href="/dashboard/checkin">Attendees &amp; Check-In Scanner</a><span style="color:#999">Speakers &middot; Vendors (next)</span></nav>
  <h2 id="my">My Events</h2>
  <table><thead><tr><th>ID</th><th>Name</th><th>Starts</th><th>Seats</th><th>Status</th><th></th></tr></thead><tbody id="events"></tbody></table>
  <h2 id="create">Create Event</h2>
  <form id="createForm">
    <fieldset><legend>1. Event basics</legend>
      <label>Event name</label><input name="name" required maxlength="200">
      <label>Image</label><input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
      <label>Description</label><textarea name="description" rows="4"></textarea>
      <label>Tag</label><select name="tag"><option value="">(none)</option><option>Festival</option><option>Community</option><option>Music</option><option>Networking</option><option>Conference</option></select>
      <label>Website</label><select name="website_id"><option value="1">patronjourney.com</option><option value="2">pjrny.com</option></select>
    </fieldset>
    <fieldset><legend>2. Date &amp; time</legend><div class="row">
      <div><label>Start</label><input name="start" type="datetime-local" required></div><div><label>End</label><input name="end" type="datetime-local" required></div></div>
      <label>Timezone</label><input name="timezone" value="America/Chicago"></fieldset>
    <fieldset><legend>3. Location</legend>
      <label>Venue name</label><input name="venue_name"><label>Address</label><input name="street">
      <div class="row"><div><label>City</label><input name="city"></div><div><label>State</label><input name="state"></div><div><label>Zip</label><input name="zip"></div><div><label>Country</label><input name="country" value="US"></div></div></fieldset>
    <fieldset><legend>4. Capacity</legend><label>Maximum capacity</label><input name="capacity" type="number" min="1" value="100" required></fieldset>
    <fieldset class="chk"><legend>5. Tickets</legend><p>General Admission (free) is always included.</p>
      <label><input type="checkbox" name="pay_at_door"> Pay At Door</label><label><input type="checkbox" name="volunteer"> Volunteer</label><label><input type="checkbox" name="staff"> Staff</label></fieldset>
    <fieldset><legend>Headliner / speaker (optional)</legend><label>Name</label><input name="speaker">
      <div class="row"><div><label>Set start</label><input name="sp_start" type="datetime-local"></div><div><label>Set end</label><input name="sp_end" type="datetime-local"></div></div></fieldset>
    <p class="chk"><label><input type="checkbox" name="publish"> Publish on the website now</label></p>
    <div id="createMsg" class="msg hidden"></div><button>Create event</button>
  </form>
</section>`, DASH_JS);
}

const H5QR_SRC = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
const H5QR_SRI = "sha384-c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+";

const CHECKIN_JS = `
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
async function api(path, opts = {}) {
  const r = await pjFetch(path, opts);
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = '/dashboard'; throw new Error('Sign in required'); }
  if (!r.ok && !d.result) throw new Error(d.message || ('HTTP ' + r.status));
  return d;
}
let eventId = null, scanner = null, last = { code: '', t: 0 }, busy = false;
function banner(kind, title, sub) {
  const b = $('result'); b.className = 'banner ' + kind; b.innerHTML = '<div class="big">' + esc(title) + '</div><div>' + esc(sub || '') + '</div>';
  if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? 80 : [60, 60, 60]);
}
async function loadEvents() {
  const d = await api('/api/organizer/events');
  const sel = $('event'); sel.innerHTML = '';
  const qs = new URLSearchParams(location.search).get('event');
  for (const r of d.events.filter((x) => x.status !== 'archived')) {
    const o = document.createElement('option'); o.value = r.odoo_event_id;
    o.textContent = '#' + r.odoo_event_id + ' ' + ((r.odoo && r.odoo.name) || '') + (r.odoo && r.odoo.local_start ? ' (' + r.odoo.local_start + ')' : '');
    if (qs && String(r.odoo_event_id) === qs) o.selected = true; sel.appendChild(o);
  }
  if (!sel.options.length) { $('noevents').classList.remove('hidden'); return; }
  eventId = Number(sel.value); loadAttendees();
}
async function loadAttendees() {
  if (!eventId) return;
  const d = await api('/api/organizer/events/' + eventId + '/attendees');
  $('counts').textContent = d.counts.registered + ' registered, ' + d.counts.checked_in + ' checked in, ' + d.counts.pending + ' pending' + (d.counts.cancelled ? ', ' + d.counts.cancelled + ' cancelled' : '');
  $('att').innerHTML = d.attendees.map((a) => '<tr><td>' + esc(a.name) + '<br><small>' + esc(a.email) + '</small></td><td>' + esc(a.ticket) + '</td><td>' + esc(a.status) +
    (a.checked_in_at_local ? '<br><small>' + esc(a.checked_in_at_local) + '</small>' : '') + '</td><td>' +
    (a.state === 'open' || a.state === 'draft' ? '<button class="secondary" data-bc="' + esc(a.barcode) + '">Check in</button>' : '') + '</td></tr>').join('');
  for (const b of document.querySelectorAll('#att button[data-bc]')) b.onclick = () => submit(b.dataset.bc);
}
async function submit(code) {
  code = String(code || '').trim(); if (!code || !eventId || busy) return;
  const now = Date.now(); if (code === last.code && now - last.t < 3000) return; last = { code, t: now };
  busy = true;
  try {
    const d = await api('/api/organizer/events/' + eventId + '/checkin', { method: 'POST', body: JSON.stringify({ barcode: code }) });
    const who = d.attendee ? (d.attendee.name || d.attendee.email || '') + (d.attendee.ticket ? ' · ' + d.attendee.ticket : '') : '';
    banner(d.result === 'checked_in' ? 'ok' : 'bad', (d.result === 'checked_in' ? '✅ ' : '❌ ') + d.message, who);
    loadAttendees();
  } catch (e) { banner('bad', '❌ Error', e.message); }
  finally { busy = false; }
}
$('event').onchange = () => { eventId = Number($('event').value); loadAttendees(); };
$('manual').onsubmit = (e) => { e.preventDefault(); submit($('code').value); $('code').value = ''; };
$('refresh').onclick = () => loadAttendees();
$('start').onclick = async () => {
  if (!window.Html5Qrcode) { banner('bad', 'Scanner library did not load', 'Use manual entry.'); return; }
  if (!scanner) scanner = new Html5Qrcode('reader');
  try {
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 250 } }, (text) => submit(text), () => {});
    $('start').classList.add('hidden'); $('stop').classList.remove('hidden');
  } catch (e) { banner('bad', 'Camera unavailable', String(e && e.message || e)); }
};
$('stop').onclick = async () => { if (scanner) await scanner.stop().catch(() => {}); $('stop').classList.add('hidden'); $('start').classList.remove('hidden'); };
api('/api/auth/me').then((me) => { $('who').textContent = me.organizer.email; loadEvents(); }).catch(() => {});
`;

export function checkinPage(env: Env): string {
  return shell(env, "Check-In Scanner", `
<style>.banner{padding:1rem;border-radius:10px;margin:1rem 0;text-align:center}.banner .big{font-size:1.6rem;font-weight:700}
.banner.ok{background:#e9f7ef;color:#11643a}.banner.bad{background:#fdecea;color:#8a1c12}.banner.idle{background:#f4f1f8;color:#555}#reader{max-width:420px;margin:auto}</style>
<p><a href="/dashboard">&larr; Dashboard</a> &middot; Signed in as <b id="who"></b></p>
<label>Event</label><select id="event"></select>
<p id="noevents" class="msg err hidden">You have no active events yet.</p>
<div id="result" class="banner idle"><div class="big">Ready to scan</div><div>Point the camera at the attendee's ticket QR code.</div></div>
<div id="reader"></div>
<p><button id="start">Start camera</button> <button id="stop" class="secondary hidden">Stop camera</button></p>
<form id="manual" class="row"><div><label>Or type the ticket barcode</label><input id="code" inputmode="numeric" autocomplete="off"></div><div style="align-self:end"><button>Check in</button></div></form>
<h2>Attendees <small id="counts" style="font-weight:400;font-size:.9rem"></small> <button id="refresh" class="secondary">Refresh</button></h2>
<table><thead><tr><th>Attendee</th><th>Ticket</th><th>Status</th><th></th></tr></thead><tbody id="att"></tbody></table>
<script src="${H5QR_SRC}" integrity="${H5QR_SRI}" crossorigin="anonymous"></script>`, CHECKIN_JS);
}
