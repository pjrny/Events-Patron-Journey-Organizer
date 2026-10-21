/** GET /competitors — Competitor Radar (plain JS). Data: Patron Journey festival directory; no contact data. */
const LOGO = "https://www.pjrny.com/web/image/35660-8cb95553/ChatGPT%20Image%204.%20Sept.%202025%2C%2012_23_31.webp?access_token=a2f29a7f-65bb-4d95-8090-27c84e4371f1";
const CONTACT = "https://www.pjrny.com/#Contact-us";
export function competitorsPage(): string {
  return String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Competitor Radar | Patron Journey</title>
<meta name="description" content="Free: see which festivals compete with your dates within 100 km, how big a threat each is, and the open weekends nearby.">
<meta property="og:title" content="Competitor Radar: who else is on your weekend?"><meta property="og:image" content="${LOGO}"><meta property="og:site_name" content="Patron Journey">
<style>
:root{--cream:#F8F4EC;--gold:#B8932E;--gold2:#C9A43A;--ink:#2b2418;--muted:#6b604c;--line:#e4dccb}
*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
h1,h2,h3{font-family:Georgia,"Times New Roman",serif;margin:0 0 .5em}
header{display:flex;align-items:center;gap:14px;padding:16px 20px;border-bottom:2px solid var(--gold)}
header img{width:64px;height:auto;border-radius:6px}header p{margin:0;color:var(--muted)}
main{max-width:1050px;margin:0 auto;padding:20px}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:16px}
form{display:grid;grid-template-columns:2fr 1fr 80px 1fr auto;gap:10px;align-items:end}@media(max-width:760px){form{grid-template-columns:1fr}}
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
<style>.bar{display:inline-block;height:8px;background:var(--gold);border-radius:4px;vertical-align:middle}td{vertical-align:top}.why{color:var(--muted);font-size:12px}</style></head><body>
<header><img src="${LOGO}" alt="Patron Journey"><div><h1>Competitor Radar</h1><p>Festivals within 100 km and two weeks of your dates, a threat score for each, and the quietest weekends nearby. Free.</p></div></header>
<main>
<div class="card"><form id="f">
 <div><label for="city">City</label><input id="city" required placeholder="Austin, TX" maxlength="120"></div>
 <div><label for="date">Start date</label><input id="date" type="date" required></div>
 <div><label for="days">Days</label><select id="days"><option>1</option><option selected>2</option><option>3</option><option>4</option><option>5</option></select></div>
 <div><label for="genre">Type / genre</label><input id="genre" placeholder="Music, EDM, Food, Beer..." maxlength="60"></div>
 <button class="btn" type="submit">Scan</button>
 <div style="grid-column:1/-1"><label for="lineup">Lineup (optional, one artist per line)</label><textarea id="lineup" rows="2" style="width:100%;border:1px solid var(--line);border-radius:6px;padding:8px"></textarea></div>
</form></div>
<div id="out"></div>
<p class="small">Data: Patron Journey festival directory (26,780 listings; dates mostly from 2018 editions, projected onto your year). City-level locations. Threat = proximity × date overlap × genre × size × lineup overlap.</p>
</main>
<script>
function $(i){return document.getElementById(i)}
function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
var q=new URLSearchParams(location.search);['city','date','genre','days'].forEach(function(k){if(q.get(k))$(k).value=q.get(k)});
function run(){
  var p=new URLSearchParams({city:$('city').value,date:$('date').value,days:$('days').value,genre:$('genre').value,lineup:$('lineup').value});
  history.replaceState(null,'','?'+new URLSearchParams({city:$('city').value,date:$('date').value,days:$('days').value,genre:$('genre').value}));
  $('out').innerHTML='<div class="card">Scanning...</div>';
  fetch('/api/competitors?'+p).then(function(r){return r.json()}).then(function(r){
    if(r.error||!r.events){$('out').innerHTML='<div class="err">'+e((r.error&&r.error.message)||r.message||'Something went wrong')+'</div>';return}
    var x='<div class="card hero"><div class="score"><b>'+r.competition_score+'</b><span>competition</span></div><div><h2>'+r.count+' festival'+(r.count===1?'':'s')+' '+e(r.basis)+'</h2><p class="small">Located by '+e(r.input.located_by)+'. Score = 100 x (1 - e^(-total threat / 300)).</p><div class="cta"><a class="btn" href="/weather">Check the weather too</a><a class="btn alt" href="'+'${CONTACT}'+'" target="_top">Talk to us</a></div></div></div>';
    if(r.open_weekends&&r.open_weekends.length){x+='<div class="card"><h3>Open weekends (±6 weeks)</h3><table><tr><th>Weekend</th><th>Total threat</th><th>Events within 7 days</th><th>Biggest</th></tr>'+r.open_weekends.map(function(w){return '<tr><td>'+e(w.label)+(w.weeks_from_target===0?' (your dates)':' ('+(w.weeks_from_target>0?'+':'')+w.weeks_from_target+' wk)')+'</td><td>'+w.total_threat+'</td><td>'+w.events_within_7_days+'</td><td>'+(w.biggest?e(w.biggest.name)+' ('+w.biggest.threat+')':'-')+'</td></tr>'}).join('')+'</table></div>'}
    x+='<div class="card"><h3>Competing festivals</h3>'+(r.events.length?'<table><tr><th>Festival</th><th>Threat</th><th>Why</th></tr>'+r.events.map(function(c){var f=c.factors;return '<tr><td><b>'+e(c.name)+'</b><br><span class="why">'+e(c.type||'')+(c.genre&&c.genre.charAt(0)!=='~'?' / '+e(c.genre):'')+'<br>'+e(c.city||'')+(c.distance_km!=null?' &middot; '+Math.round(c.distance_km)+' km':'')+' &middot; '+e(c.projected_start||c.listed_start||'')+'</span>'+(c.website?'<br><a class="why" href="'+e(c.website)+'" target="_blank" rel="noopener">'+e(c.website.replace('https://',''))+'</a>':'')+'</td><td><span class="bar" style="width:'+Math.max(4,c.threat)+'px"></span> '+c.threat+'</td><td class="why" style="text-align:left">'+['proximity','date_overlap','genre','size','lineup'].map(function(k){return e(k.replace('_',' '))+' ×'+f[k].value+': '+e(f[k].why)}).join('<br>')+'</td></tr>'}).join('')+'</table>':'<p>No listed festivals in that window. Nice.</p>')+'<p class="small">'+r.notes.map(e).join('<br>')+'</p></div>';
    $('out').innerHTML=x;
  }).catch(function(){$('out').innerHTML='<div class="err">Network error. Try again.</div>'});
}
$('f').onsubmit=function(ev){ev.preventDefault();run()};
if(q.get('city')&&q.get('date'))run();
</script></body></html>`;
}
