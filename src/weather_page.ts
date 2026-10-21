/** GET /weather and GET /weather/r/:id — "Will It Rain On My Event?" (plain JS, no build step). */
const LOGO = "https://www.pjrny.com/web/image/35660-8cb95553/ChatGPT%20Image%204.%20Sept.%202025%2C%2012_23_31.webp?access_token=a2f29a7f-65bb-4d95-8090-27c84e4371f1";
const CONTACT = "https://www.pjrny.com/#Contact-us";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function weatherPage(base: string, result: any | null = null): string {
  const title = result ? `${result.headline} | Will It Rain On My Event?` : "Will It Rain On My Event? | Patron Journey";
  const desc = result
    ? `Risk ${result.risk.score}/100 (${result.risk.label}). ${result.history.storms.phrase}. ${result.backup_plan[0] ?? ""}`
    : "Free event weather risk check: 5 years of history for your dates, storms, wind, heat, holidays, plus a backup plan.";
  const url = result ? `${base}/weather/r/${result.id}` : `${base}/weather`;
  const data = result ? JSON.stringify(result).replace(/</g, "\\u003c") : "null";
  return String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Patron Journey">
<meta property="og:title" content="${esc(result ? result.headline : "Will It Rain On My Event?")}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${LOGO}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(result ? result.headline : "Will It Rain On My Event?")}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${LOGO}">
<style>
:root{--cream:#F8F4EC;--gold:#B8932E;--gold2:#C9A43A;--ink:#2b2418;--muted:#6b604c;--line:#e4dccb}
*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
h1,h2,h3{font-family:Georgia,"Times New Roman",serif;margin:0 0 .5em}
header{display:flex;align-items:center;gap:14px;padding:16px 20px;border-bottom:2px solid var(--gold)}
header img{width:64px;height:auto;border-radius:6px}header p{margin:0;color:var(--muted)}
main{max-width:1050px;margin:0 auto;padding:20px}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:16px}
form{display:grid;grid-template-columns:2fr 1fr 110px auto;gap:10px;align-items:end}@media(max-width:760px){form{grid-template-columns:1fr}}
label{display:block;font-size:13px;color:var(--muted);margin:0 0 2px}
input,select{width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;font-size:15px}
.btn{display:inline-block;background:var(--gold);color:#fff;border:0;border-radius:6px;padding:10px 14px;font-weight:600;text-decoration:none;cursor:pointer;font-size:15px}
.btn:hover{background:var(--gold2)}.btn.alt{background:#fff;color:var(--gold);border:1px solid var(--gold)}
.hero{display:flex;gap:18px;align-items:center;flex-wrap:wrap}.score{width:120px;height:120px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:6px solid var(--gold);background:#fffaf0}
.score b{font:700 34px Georgia,serif}.score span{font-size:12px;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.stat{border:1px solid var(--line);border-radius:8px;padding:10px}.stat b{display:block;font:700 22px Georgia,serif}.stat small{color:var(--muted)}
ul{margin:4px 0;padding-left:20px}.small{font-size:12px;color:var(--muted)}.err{background:#fde8e8;border-left:4px solid #c0392b;padding:10px;border-radius:6px}
.note{background:#fff7e0;border-left:4px solid var(--gold);padding:10px;border-radius:6px;font-size:14px}
.cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}.tog{font-size:13px}.tog button{border:1px solid var(--line);background:#fff;padding:4px 10px;border-radius:5px;cursor:pointer}.tog button.on{background:var(--gold);color:#fff;border-color:var(--gold)}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:5px;border-bottom:1px solid var(--line);text-align:right}td:first-child,th:first-child{text-align:left}
</style></head><body>
<header><img src="${LOGO}" alt="Patron Journey"><div><h1>Will It Rain On My Event?</h1><p>Five years of weather for your exact dates, plus storms, wind, heat, holidays and a backup plan. Free.</p></div></header>
<main>
<div class="card"><form id="f">
 <div><label for="addr">Event address</label><input id="addr" required placeholder="Zilker Park, Austin, TX" maxlength="200"></div>
 <div><label for="date">Start date</label><input id="date" type="date" required></div>
 <div><label for="days">Days</label><select id="days"><option>1</option><option selected>2</option><option>3</option><option>4</option><option>5</option></select></div>
 <button class="btn" id="go" type="submit">Check my dates</button>
</form></div>
<div id="out"></div>
<p class="small">Weather: Open-Meteo (historical reanalysis + forecast). Geocoding: © OpenStreetMap contributors via Nominatim. Holidays: Nager.Date. Results are based on a small 5-year sample for the same dates, not a guarantee. Competing festival locations use <a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a> data (CC BY 4.0).</p>
</main>
<script>
var PRE = ${data};
var unit = null, R = null;
var $ = function(id){return document.getElementById(id)};
function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function T(c){ if(c==null) return '?'; return unit==='F' ? Math.round(c*9/5+32)+'°F' : Math.round(c)+'°C'; }
function both(c){ return c==null?'?':Math.round(c*9/5+32)+'°F / '+Math.round(c)+'°C'; }
function render(r){
  R = r; if(!unit) unit = r.units['default'];
  var h = r.history, s = r.simulator;
  var permalink = location.origin + r.permalink;
  var x = '<div class="card"><div class="hero"><div class="score"><b>'+r.risk.score+'</b><span>'+e(r.risk.label)+' risk</span></div><div style="flex:1;min-width:240px">'
   + '<h2>'+e(r.headline)+'</h2><div>'+e(r.location.display_name)+'</div>'
   + '<div class="small">'+e(r.dates.weekdays.join(', '))+' · checked '+h.years.join(', ')+(r.forecast?' · live forecast blended in':'')+'</div>'
   + '<div class="tog" style="margin-top:6px">Units: <button type="button" data-u="F" class="'+(unit==='F'?'on':'')+'">°F</button> <button type="button" data-u="C" class="'+(unit==='C'?'on':'')+'">°C</button></div>'
   + '<div class="cta"><button class="btn alt" type="button" id="share">Share this result</button><a class="btn" href="/dashboard" target="_top">Plan this event free</a><a class="btn alt" href="${CONTACT}" target="_top">Talk to us about full production</a></div>'
   + '<div class="small" id="shareMsg"></div></div></div></div>';
  x += '<div class="card"><h3>Last '+h.years_checked+' years on your dates</h3><div class="grid">'
   + stat(h.rain.pct+'%', 'chance of rain', h.rain.phrase)
   + stat(h.storms.pct+'%', 'storm risk', h.storms.phrase)
   + stat(h.wind.max_gust_kmh==null?'?':Math.round(unit==='F'?h.wind.max_gust_kmh/1.609:h.wind.max_gust_kmh)+(unit==='F'?' mph':' km/h'), 'max gust seen', h.wind.phrase)
   + stat(T(h.temps.avg_high_c)+' / '+T(h.temps.avg_low_c), 'typical high / low', both(h.temps.avg_high_c)+' high; '+both(h.temps.avg_low_c)+' low')
   + stat(h.heat.years_hit+' of '+h.years_checked, 'years over 90°F / 32°C', '')
   + stat(h.cold.years_hit+' of '+h.years_checked, 'years under 41°F / 5°C', '')
   + '</div></div>';
  if (r.forecast) { x += '<div class="card"><h3>Live forecast</h3><table><tr><th>Date</th><th>Rain</th><th>Gusts</th><th>High / Low</th></tr>'
    + r.forecast.days.map(function(d){return '<tr><td>'+d.date+'</td><td>'+(d.precip_mm==null?'?':d.precip_mm+' mm')+'</td><td>'+(d.gust_kmh==null?'?':Math.round(d.gust_kmh)+' km/h')+'</td><td>'+T(d.tmax_c)+' / '+T(d.tmin_c)+'</td></tr>'}).join('')+'</table></div>'; }
  x += '<div class="card"><h3>Backup plan</h3><ul>'+r.backup_plan.map(function(p){return '<li>'+e(p)+'</li>'}).join('')+'</ul></div>';
  x += '<div class="card"><h3>What this means for your numbers</h3><ul>'
   + '<li>Walk-up sales: <b>'+pctx(s.attendance.walk_up_multiplier)+'</b>, pay-at-door: <b>'+pctx(s.attendance.pay_at_door_multiplier)+'</b></li>'
   + '<li>Bar spend per head: <b>'+pctx(s.bar_spend_multiplier)+'</b></li>'
   + '<li>Forecast spread widens <b>'+pctx(s.variance_widen)+'</b></li>'
   + s.feed.map(function(f){return '<li>'+e(f)+'</li>'}).join('') + '</ul>'
   + '<p class="small">Run these through the Festival Forecaster to see your P&amp;L under this weather.</p></div>';
  x += '<div class="card"><h3>Holidays &amp; competition</h3>'
   + (r.holidays.length ? '<ul>'+r.holidays.map(function(h){return '<li>'+e(h.date)+': '+e(h.name)+'</li>'}).join('')+'</ul>' : '<p>No public holidays on or next to your dates.</p>')
   + (r.competition ? '<p><b>'+r.competition.count+'</b> festival'+(r.competition.count===1?'':'s')+' '+e(r.competition.basis||'')+' of '+e(r.location.city||'you')+(r.competition.competition_score!=null?' &middot; competition score <b>'+r.competition.competition_score+'</b>/100':'')+'. <a href="/competitors">Full competitor analysis</a></p>'
      + (r.competition.events&&r.competition.events.length ? '<ul>'+r.competition.events.slice(0,15).map(function(c){var MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];var when=c.start_date?MN[+c.start_date.slice(5,7)-1]+' '+(+c.start_date.slice(8,10))+(c.end_date&&c.end_date!==c.start_date?'-'+(c.end_date.slice(5,7)===c.start_date.slice(5,7)?+c.end_date.slice(8,10):MN[+c.end_date.slice(5,7)-1]+' '+(+c.end_date.slice(8,10))):''):(c.month?MN[c.month-1]:'');return '<li>'+e(c.name)+' <span class="small">('+e(c.type||'')+(c.genre&&c.genre.charAt(0)!=='~'?' / '+e(c.genre):'')+') '+e(when)+(c.threat!=null?' &middot; threat '+c.threat:'')+' &middot; '+e(c.city||'')+(c.distance_km!=null?' &middot; '+(unit==='F'?Math.round(c.distance_km*0.621)+' mi':Math.round(c.distance_km)+' km'):'')+'</span></li>'}).join('')+'</ul>'+(r.competition.count>15?'<p class="small">+'+(r.competition.count-15)+' more.</p>':'')+'<p class="small">Dates are from the last listed edition (mostly 2018); recurring festivals usually keep the same month.</p>' : '') : '')
   + '<p class="small">'+r.notes.map(e).join('<br>')+'</p></div>';
  $('out').innerHTML = x;
  Array.prototype.forEach.call(document.querySelectorAll('[data-u]'), function(b){ b.onclick=function(){ unit=b.getAttribute('data-u'); render(R); }; });
  $('share').onclick = function(){
    var txt = r.headline+' — risk '+r.risk.score+'/100. Here\'s the backup plan:';
    if (navigator.share) { navigator.share({title:r.headline,text:txt,url:permalink}).catch(function(){}); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(permalink) : Promise.reject()).then(function(){ $('shareMsg').textContent='Link copied: '+permalink; }, function(){ $('shareMsg').textContent=permalink; });
  };
}
function stat(b, l, sub){ return '<div class="stat"><b>'+e(b)+'</b>'+e(l)+'<br><small>'+e(sub)+'</small></div>'; }
function pctx(m){ var p = Math.round((m-1)*100); return (p>0?'+':'')+p+'%'; }
$('f').onsubmit = function(ev){ ev.preventDefault();
  var q = new URLSearchParams({address:$('addr').value, date:$('date').value, days:$('days').value});
  $('go').disabled = true; $('go').textContent = 'Checking 5 years…'; unit = null;
  fetch('/api/weather/risk?'+q).then(function(r){return r.json()}).then(function(j){
    if (!j.ok) { $('out').innerHTML = '<div class="err">'+e(j.message||'Something went wrong')+'</div>'; return; }
    render(j); try { history.replaceState(null,'',j.permalink); } catch(_){}
  }).catch(function(){ $('out').innerHTML='<div class="err">Network error. Try again.</div>'; })
  .then(function(){ $('go').disabled=false; $('go').textContent='Check my dates'; });
};
if (PRE) { $('addr').value = PRE.input.address; $('date').value = PRE.input.date; $('days').value = String(PRE.input.days); render(PRE); }
</script></body></html>`;
}
