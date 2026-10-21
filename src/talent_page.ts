/** GET /talent and GET /talent/r/:id — Talent Draw Estimator (plain JS, no build step). */
const LOGO = "https://www.pjrny.com/web/image/35660-8cb95553/ChatGPT%20Image%204.%20Sept.%202025%2C%2012_23_31.webp?access_token=a2f29a7f-65bb-4d95-8090-27c84e4371f1";
const CONTACT = "https://www.pjrny.com/#Contact-us";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function talentPage(base: string, result: any | null = null): string {
  const title = result ? `${result.headline} | Talent Draw Estimator` : "Talent Draw Estimator | Patron Journey";
  const desc = result
    ? `${result.feed[0] ?? ""} Confidence: ${result.confidence.label}. Free lineup draw estimate from Patron Journey.`
    : "Free: paste your lineup and city, get an estimated draw per artist and for the whole bill, with every signal and discount shown.";
  const url = result ? `${base}/talent/r/${result.id}` : `${base}/talent`;
  const data = result ? JSON.stringify(result).replace(/</g, "\\u003c") : "null";
  return String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Patron Journey">
<meta property="og:title" content="${esc(result ? result.headline : "Talent Draw Estimator")}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${LOGO}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(result ? result.headline : "Talent Draw Estimator")}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${LOGO}">
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
</style>
<style>form{grid-template-columns:1fr 1fr 1fr}textarea{width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;font:14px/1.4 system-ui,sans-serif}.span{grid-column:1/-1}@media(max-width:760px){form{grid-template-columns:1fr}}
.acts{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:12px}.act h3{display:flex;justify-content:space-between;gap:8px}.act img{width:44px;height:44px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:8px}
.pill{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:10px;padding:1px 7px;margin:1px;color:var(--muted)}.big{font:700 22px Georgia,serif}.why{color:var(--muted);font-size:12px}td{vertical-align:top}</style></head><body>
<header><img src="${LOGO}" alt="Patron Journey"><div><h1>Talent Draw Estimator</h1><p>Paste your lineup. See how many people each act is likely to pull in your city, and what the whole bill adds up to. Free.</p></div></header>
<main>
<div class="card"><form id="f">
 <div class="span"><label for="lineup">Lineup (one artist per line, or comma separated; up to 40. Optional fee: <code>Artist | 25000</code>)</label><textarea id="lineup" rows="7" required maxlength="8000" placeholder="Khruangbin | 150000&#10;Leon Bridges&#10;Black Pumas&#10;Tobe Nwigwe"></textarea></div>
 <div><label for="city">City</label><input id="city" required placeholder="Houston, TX" maxlength="120"></div>
 <div><label for="date">Event date</label><input id="date" type="date"></div>
 <div><label for="capacity">Capacity</label><input id="capacity" type="number" min="1" placeholder="5000"></div>
 <div><label for="genre">Event genre</label><input id="genre" placeholder="Indie, Hip hop, EDM..." maxlength="60"></div>
 <div><label for="price">Ticket price (optional, $)</label><input id="price" type="number" min="0" step="1" placeholder="65"></div>
 <div style="align-self:end"><button class="btn" id="go" type="submit">Estimate draw</button></div>
</form></div>
<div id="out"></div>
<p class="small">Signals: Deezer, Apple iTunes Search, MusicBrainz (CC0), Google News, and the Patron Journey festival directory; Last.fm, SeatGeek, Ticketmaster and Bandsintown switch on when keys are added. Every signal is discounted by how local it is (city 1.0, metro 0.85, state 0.6, country 0.4, worldwide 0.2) and by data quality (sales 1.0, demand score 0.8, trackers 0.6, streaming/fans 0.5, press 0.3). Festival locations use <a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a> data (CC BY 4.0). Geocoding: © OpenStreetMap contributors via Nominatim.</p>
</main>
<script>
var PRE = ${data};
function $(i){return document.getElementById(i)}
function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function n(x){return x==null?'-':Number(x).toLocaleString('en-US')}
var GEO={city:'City',metro:'Metro',region:'State/region',country:'Country',global:'Worldwide'};
var CAT={past_draw:'Past draw in market',upcoming_demand:'Upcoming demand/price',tour_presence:'Tour / local presence',fan_intent:'Fan intent',listening:'Listening',press:'Press buzz',genre_fit:'Genre fit'};
function render(r){
  var t=r.lineup_total, x='<div class="card hero"><div class="score"><b>'+n(t.mid)+'</b><span>expected draw</span></div><div style="flex:1;min-width:260px"><h2>'+e(r.headline)+'</h2>'
   +'<div class="grid">'+stat(n(t.low)+'–'+n(t.high),'Range','low–high')+stat(r.confidence.label,'Confidence',Math.round(r.confidence.value*100)+'% of full signal weight')+stat(n(t.cap),'Cap',r.input.capacity&&t.cap===r.input.capacity?'your capacity':'~15% of metro pop.')+(r.simulator.cost_per_expected_ticket?stat('$'+r.simulator.cost_per_expected_ticket,'Talent cost','per expected ticket'):'')+'</div>'
   +'<ul>'+r.feed.map(function(f){return '<li>'+e(f)+'</li>'}).join('')+'</ul>'
   +'<div class="cta"><button class="btn alt" id="share" type="button">Copy share link</button><a class="btn" href="/dashboard" target="_top">Plan this event free</a><a class="btn alt" href="/weather" target="_top">Will it rain?</a><a class="btn alt" href="/competitors" target="_top">Competitor Radar</a><a class="btn alt" href="${CONTACT}" target="_top">Talk to us</a></div><div class="small" id="shareMsg"></div></div></div>';
  x+='<div class="acts">'+r.artists.map(function(a){
    return '<div class="card act"><h3><span>'+(a.picture?'<img src="'+e(a.picture)+'" alt="">':'')+'#'+a.rank+' '+e(a.name)+'</span><span class="big">'+n(a.draw.mid)+'</span></h3>'
     +'<div class="why">Draw '+n(a.draw.low)+'–'+n(a.draw.high)+' &middot; counts ×'+a.decay+' in total ('+n(a.contribution)+') &middot; score '+a.score+' &middot; confidence '+e(a.confidence_label)+(a.fee?' &middot; fee $'+n(a.fee):'')+'</div>'
     +'<div>'+(a.genres||[]).map(function(g){return '<span class="pill">'+e(g)+'</span>'}).join('')+(a.hometown?'<span class="pill">from '+e(a.hometown)+'</span>':'')+(a.found?'':'<span class="pill" style="color:#c0392b">not found</span>')+'</div>'
     +(a.signals.length?'<table><tr><th>Signal</th><th>Value</th><th>Weight</th></tr>'+a.signals.map(function(s){return '<tr><td>'+e(CAT[s.category])+'<br><span class="why">'+e(s.source)+': '+e(s.metric)+' = '+e(typeof s.raw==='number'?n(s.raw):s.raw)+(s.detail?'<br>'+e(s.detail):'')+'</span></td><td>'+s.value+'</td><td class="why">'+s.base_weight+' × '+e(GEO[s.geo])+' '+s.geo_discount+' × '+s.quality_discount+'<br>= '+s.effective_weight+'</td></tr>'}).join('')+'</table>':'<p class="why">No signals found.</p>')
     +'<div class="why">'+[a.links.deezer?'<a href="'+e(a.links.deezer)+'" target="_blank" rel="noopener">Deezer</a>':'',a.links.apple_music?'<a href="'+e(a.links.apple_music)+'" target="_blank" rel="noopener">Apple Music</a>':'',a.links.musicbrainz?'<a href="'+e(a.links.musicbrainz)+'" target="_blank" rel="noopener">MusicBrainz</a>':''].filter(Boolean).join(' &middot; ')+'</div></div>'}).join('')+'</div>';
  x+='<div class="card"><div class="note">'+e(r.disclaimer)+'</div><p class="small">'+r.notes.map(e).join('<br>')+'</p><p class="small">Lineup total = '+e(r.lineup_total.method)+'. Headliner scale for this market: '+n(r.lineup_total.headliner_scale)+'.</p></div>';
  $('out').innerHTML=x;
  $('share').onclick=function(){var u=location.origin+r.permalink;(navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){$('shareMsg').textContent='Copied: '+u},function(){$('shareMsg').textContent=u})};
}
function stat(b,l,sub){return '<div class="stat"><b>'+e(b)+'</b>'+e(l)+'<br><small>'+e(sub)+'</small></div>'}
function body(){return JSON.stringify({lineup:$('lineup').value,city:$('city').value,date:$('date').value||null,capacity:$('capacity').value||null,genre:$('genre').value||null,price:$('price').value||null})}
function call(round){
  return fetch('/api/talent/draw',{method:'POST',headers:{'content-type':'application/json'},body:body()}).then(function(r){return r.json()}).then(function(j){
    if(!j.ok){$('out').innerHTML='<div class="err">'+e(j.message||'Something went wrong')+'</div>';return}
    if(j.incomplete){ if(round>=12){$('out').innerHTML='<div class="err">Lookups are slow right now. Try again in a minute; finished artists are saved.</div>';return}
      $('out').innerHTML='<div class="card">'+e(j.message)+'</div>'; return call(round+1)}
    render(j); try{history.replaceState(null,'',j.permalink)}catch(_){}
  });
}
$('f').onsubmit=function(ev){ev.preventDefault();$('go').disabled=true;$('go').textContent='Looking up artists…';$('out').innerHTML='<div class="card">Looking up artists (MusicBrainz allows 1 request/second, so big lineups take a moment)…</div>';
  call(0).catch(function(){$('out').innerHTML='<div class="err">Network error. Try again.</div>'}).then(function(){$('go').disabled=false;$('go').textContent='Estimate draw'})};
if(PRE){var i=PRE.input;$('lineup').value=i.artists.map(function(a){return a.name+(a.fee?' | '+a.fee:'')}).join('\n');$('city').value=i.city||'';$('date').value=i.date||'';$('capacity').value=i.capacity||'';$('genre').value=i.genre||'';$('price').value=i.ticket_price||'';render(PRE)}
</script></body></html>`;
}
