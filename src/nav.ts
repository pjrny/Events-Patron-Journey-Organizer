/**
 * Shared Patron Journey tools nav (one module for every page). Served as GET /pj-nav.js and included by
 * /dashboard, /weather, /talent, /competitors, /rfid and the static /forecaster/ (forecast_sim_event).
 * Usage: <script src="https://events-patronjourney.message-0ad.workers.dev/pj-nav.js" data-active="talent" defer></script>
 * Injects a sticky top bar (collapses to a Menu button under 860px). All links use target="_top" so they
 * leave the iframe when a tool is embedded on pjrny.com. Sets the CSS variable --pj-nav-h on <html>
 * so pages with their own sticky header can sit below it.
 */
export const NAV_LINKS = {
  tools: [
    { key: "forecaster", label: "Festival Simulator", path: "/forecaster/" },
    { key: "weather", label: "Weather", path: "/weather" },
    { key: "talent", label: "Talent Draw", path: "/talent" },
    { key: "competitors", label: "Competitors", path: "/competitors" },
    { key: "rfid", label: "RFID Planner", path: "/rfid" },
  ],
  dashboard: { key: "dashboard", label: "Dashboard", path: "/dashboard" },
  events: "https://www.patronjourney.com/event",
  login: "https://www.pjrny.com/web/login",
  account: "https://www.pjrny.com/my",
  signup: "https://www.pjrny.com/web/signup",
  help: "https://www.patronjourney.com/knowledge/article/42",
};

export function navJs(origin: string): string {
  const cfg = JSON.stringify({ ...NAV_LINKS, origin });
  return `/* Patron Journey shared tools nav (src/nav.ts). */
(function(){
if (window.__pjNav) return; window.__pjNav = 1;
var C = ${cfg};
var me = document.currentScript || document.querySelector('script[src*="pj-nav.js"]');
var active = (me && me.getAttribute('data-active')) || '';
if (!active) { var p = location.pathname; [C.dashboard].concat(C.tools).forEach(function(t){ if (p.indexOf(t.path.replace(/\\/$/,'')) === 0) active = t.key; }); }
var css = '#pjnav{position:sticky;top:0;z-index:1000;background:#2B2620;color:#F8F4EC;font:14px/1.3 Helvetica,Arial,system-ui,sans-serif;border-bottom:3px solid #B8932E;box-shadow:0 2px 8px rgba(0,0,0,.15)}'
+'#pjnav *{box-sizing:border-box}#pjnav a{color:#F8F4EC;text-decoration:none;margin:0}#pjnav p{line-height:1.4}'
+'#pjnav .pjn-in{display:flex;align-items:center;gap:6px;max-width:1440px;margin:0 auto;padding:6px 12px;flex-wrap:wrap}'
+'#pjnav .pjn-brand{font:700 15px Georgia,"Times New Roman",serif;color:#B8932E!important;margin-right:6px;white-space:nowrap}'
+'#pjnav .pjn-links{display:flex;align-items:center;gap:2px;flex-wrap:wrap;flex:1}'
+'#pjnav .pjn-links a,#pjnav summary{padding:6px 9px;border-radius:6px;white-space:nowrap;cursor:pointer}'
+'#pjnav .pjn-links a:hover,#pjnav summary:hover{background:rgba(184,147,46,.25)}'
+'#pjnav .pjn-links a.on{background:#B8932E;color:#fff}'
+'#pjnav .pjn-sep{width:1px;height:20px;background:rgba(248,244,236,.25);margin:0 4px}'
+'#pjnav details{position:relative}#pjnav summary{list-style:none}#pjnav summary::-webkit-details-marker{display:none}'
+'#pjnav .pjn-help{position:absolute;right:0;top:calc(100% + 6px);background:#FFFDF8;color:#2B2620;border:1px solid #e4dccb;border-top:3px solid #B8932E;border-radius:8px;padding:12px 14px;width:300px;box-shadow:0 8px 24px rgba(0,0,0,.18)}'
+'#pjnav .pjn-help a{color:#B8932E;font-weight:600}#pjnav .pjn-help p{margin:0 0 8px}#pjnav .pjn-help small{color:#6B6257}'
+'#pjnav .pjn-tog{display:none;margin-left:auto;background:#B8932E;color:#fff;border:0;border-radius:6px;padding:7px 12px;font:600 14px Helvetica,Arial,sans-serif;cursor:pointer}'
+'@media(max-width:860px){#pjnav .pjn-tog{display:block}#pjnav .pjn-links{display:none;flex-basis:100%;flex-direction:column;align-items:stretch;padding:6px 0}'
+'#pjnav.open .pjn-links{display:flex}#pjnav .pjn-sep{width:100%;height:1px;margin:4px 0}#pjnav .pjn-help{position:static;width:auto;margin-top:6px}'
+'#pjnav.open{max-height:100vh;overflow:auto}}'
+'@media print{#pjnav{display:none}}';
var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
function a(href, label, key, title){ return '<a href="'+href+'" target="_top"'+(key && key===active?' class="on" aria-current="page"':'')+(title?' title="'+title+'"':'')+'>'+label+'</a>'; }
var O = C.origin;
var h = '<div class="pjn-in"><a class="pjn-brand" href="https://www.pjrny.com/" target="_top">Patron Journey</a>'
 + '<button class="pjn-tog" type="button" aria-expanded="false" aria-controls="pjn-links">Menu</button>'
 + '<div class="pjn-links" id="pjn-links">'
 + a(O + C.dashboard.path, C.dashboard.label, C.dashboard.key, 'Organizer dashboard: events and tickets')
 + '<span class="pjn-sep"></span>'
 + C.tools.map(function(t){ return a(O + t.path, t.label, t.key); }).join('')
 + '<span class="pjn-sep"></span>'
 + a(C.events, 'Events', '', 'Main ticketing site: patronjourney.com/event')
 + '<details><summary>Help Center ▾</summary><div class="pjn-help">'
 + '<p><b>Knowledge Center</b> <small>(sign-in required)</small></p>'
 + '<p><small>For patrons:</small><br>'+'<a href="'+C.help+'" target="_top">How to register &middot; How to top up</a></p>'
 + '<p><small>For staff:</small><br>'+'<a href="'+C.help+'" target="_top">POS how-to &middot; How to scan &middot; How to top up</a></p>'
 + '<small>Sign in on pjrny.com first. No account? <a href="'+C.signup+'" target="_top">Sign up</a></small></div></details>'
 + a(C.login, 'Log in', '', 'pjrny.com login') + a(C.account, 'My account', '', 'pjrny.com account')
 + '</div></div>';
var nav = document.createElement('nav'); nav.id = 'pjnav'; nav.setAttribute('aria-label', 'Patron Journey tools'); nav.innerHTML = h;
function mount(){
  document.body.insertBefore(nav, document.body.firstChild);
  var tog = nav.querySelector('.pjn-tog');
  tog.onclick = function(){ var o = nav.classList.toggle('open'); tog.setAttribute('aria-expanded', o ? 'true' : 'false'); tog.textContent = o ? 'Close' : 'Menu'; };
  document.addEventListener('click', function(e){ var d = nav.querySelector('details'); if (d && d.open && !d.contains(e.target)) d.open = false; });
  function setH(){ document.documentElement.style.setProperty('--pj-nav-h', nav.offsetHeight + 'px'); }
  setH(); window.addEventListener('resize', setH);
}
if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
`;
}
