// Minimal organizer dashboard (no build step). Talks to /api/auth/* and /api/organizer/* with the session cookie.
import type { Env } from "./env";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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
<body><h1>${esc(title)}</h1>${body}
<hr><p><small>Free tier: free and pay-at-door tickets only. Paid tickets, POS, RFID, mobile apps and advanced attendance:
<a href="${esc(env.PAID_UPGRADE_URL)}">contact Patron Journey</a>.</small></p>
<script>${script}</script></body></html>`;

export function magicConfirmPage(env: Env, token: string): string {
  // GET does not consume the token (email link scanners pre-fetch links). The button POSTs it.
  return shell(env, "Sign in", `<form method="post" action="/auth/magic"><input type="hidden" name="token" value="${esc(token)}">
<p>Click to finish signing in to the Patron Journey organizer dashboard.</p><button type="submit">Sign in</button></form>`);
}

export function errorPage(env: Env, message: string): string {
  return shell(env, "Sign in", `<div class="msg err">${esc(message)}</div><p><a href="/dashboard">Back to sign in</a></p>`);
}

const DASH_JS = `
const $ = (id) => document.getElementById(id);
const show = (el, txt, ok) => { el.className = 'msg ' + (ok ? 'ok' : 'err'); el.textContent = txt; el.classList.remove('hidden'); };
async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...opts });
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
  try { await api('/api/auth/pin', { method: 'POST', body: JSON.stringify({ email: $('pEmail').value, pin: $('pPin').value }) }); location.reload(); }
  catch (err) { show($('loginMsg'), err.message, false); } };
$('logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.reload(); };
async function loadEvents() {
  const d = await api('/api/organizer/events'); const tb = $('events'); tb.innerHTML = '';
  for (const r of d.events) { const e = r.odoo || {}; const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + r.odoo_event_id + '</td><td></td><td>' + (e.local_start || '') + '</td><td>' + (e.seats_taken ?? 0) + ' / ' + (e.seats_max ?? '') + '</td><td>' + (r.status === 'archived' ? 'archived' : (e.website_published ? 'published' : 'draft')) + '</td><td></td>';
    tr.children[1].textContent = e.name || '(missing in Odoo)';
    if (r.status !== 'archived') { const b = document.createElement('button'); b.className = 'secondary'; b.textContent = e.website_published ? 'Unpublish' : 'Publish';
      b.onclick = async () => { await api('/api/organizer/events/' + r.odoo_event_id + '/publish', { method: 'POST', body: JSON.stringify({ published: !e.website_published }) }); loadEvents(); };
      tr.children[5].appendChild(b); }
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
  <div id="loginMsg" class="msg hidden"></div>
  <fieldset><legend>Email me a sign-in link</legend><form id="magicForm"><label>Email</label><input id="mEmail" type="email" required autocomplete="email"><p><button>Send link</button></p></form></fieldset>
  <fieldset><legend>Or sign in with email + PIN</legend><form id="pinForm"><label>Email</label><input id="pEmail" type="email" required autocomplete="email"><label>PIN</label><input id="pPin" type="password" inputmode="numeric" required autocomplete="current-password"><p><button>Sign in</button></p></form></fieldset>
</section>
<section id="app" class="hidden">
  <p>Signed in as <b id="who"></b> &middot; <a href="#" id="logout">Sign out</a></p>
  <nav><a href="#my">My Events</a><a href="#create">Create Event</a><span style="color:#999">Attendees &middot; Check-In Scanner &middot; Speakers &middot; Vendors (next)</span></nav>
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
