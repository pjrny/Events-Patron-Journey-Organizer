/** GET /rfid — Event Tech & RFID Planner (plain JS, no build step, no in-browser Babel). */
const LOGO = "https://www.pjrny.com/web/image/35660-8cb95553/ChatGPT%20Image%204.%20Sept.%202025%2C%2012_23_31.webp?access_token=a2f29a7f-65bb-4d95-8090-27c84e4371f1";
const CONTACT = "https://www.pjrny.com/#Contact-us";

export function rfidPage(): string {
  return String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Event Tech &amp; RFID Planner | Patron Journey</title>
<style>
:root{--cream:#F8F4EC;--gold:#B8932E;--gold2:#C9A43A;--ink:#2b2418;--muted:#6b604c;--line:#e4dccb}
*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
h1,h2,h3{font-family:Georgia,"Times New Roman",serif;margin:0 0 .5em}
header{display:flex;align-items:center;gap:14px;padding:16px 20px;border-bottom:2px solid var(--gold)}
header img{width:64px;height:auto;border-radius:6px}header p{margin:0;color:var(--muted)}
main{max-width:1150px;margin:0 auto;padding:20px;display:grid;grid-template-columns:330px 1fr;gap:18px}
@media(max-width:860px){main{grid-template-columns:1fr}}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:16px}
label{display:block;font-size:13px;color:var(--muted);margin:8px 0 2px}
input[type=number],select{width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;font-size:15px}
.tg{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:14px;color:var(--ink)}
.btn{display:inline-block;background:var(--gold);color:#fff;border:0;border-radius:6px;padding:10px 14px;font-weight:600;text-decoration:none;cursor:pointer}
.btn:hover{background:var(--gold2)}.btn.alt{background:#fff;color:var(--gold);border:1px solid var(--gold)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:7px 6px;border-bottom:1px solid var(--line);text-align:right}
th:first-child,td:first-child{text-align:left}tr.hw{background:#fbf6e8;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.stat{border:1px solid var(--line);border-radius:8px;padding:10px;text-align:center}.stat b{display:block;font-size:22px;font-family:Georgia,serif}
.note{background:#fff7e0;border-left:4px solid var(--gold);padding:10px;border-radius:6px;font-size:14px}
.prov{border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:10px}.prov.feat{border:2px solid var(--gold);background:#fffaf0}
.prov ul{margin:4px 0;padding-left:18px;font-size:13px}.small{font-size:12px;color:var(--muted)}
.pc{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#bible{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;padding:16px}
#bible .box{background:#fff;border-radius:10px;width:100%;max-width:860px;height:85vh;display:flex;flex-direction:column}
#bible textarea{flex:1;border:0;padding:16px;font:13px/1.4 monospace;resize:none}
#bible .bar{padding:12px;border-top:1px solid var(--line);display:flex;gap:8px;justify-content:flex-end}
@media print{body *{visibility:hidden}#bibleText,#bibleText *{visibility:visible}#bibleText{position:absolute;left:0;top:0;width:100%;height:auto;white-space:pre-wrap}}
</style></head><body>
<header><img src="${LOGO}" alt="Patron Journey"><div><h1>Event Tech &amp; RFID Planner</h1><p>Estimate hardware, staffing and RFID cost by provider, then generate your on-site bible.</p></div></header>
<main>
<section>
 <div class="card"><h3>Event</h3>
  <label>Attendees</label><input type="number" id="att" min="0" value="2000">
  <label>Vendors (POS)</label><input type="number" id="ven" min="0" value="10">
  <label>Show days</label><input type="number" id="days" min="1" value="2">
  <label>Entry gates</label><input type="number" id="gates" min="1" value="2">
  <label>Provider for bible</label><select id="prov"></select>
 </div>
 <div class="card"><h3>Patron journey</h3>
  <label class="tg"><input type="checkbox" id="j_access" checked> RFID access control</label>
  <label class="tg"><input type="checkbox" id="j_cashless" checked> Cashless payments / POS</label>
  <label class="tg"><input type="checkbox" id="j_topup" checked> On-site top-up stations</label>
  <label class="tg"><input type="checkbox" id="j_ship"> Mail wristbands before the event</label>
  <label class="tg"><input type="checkbox" id="j_travel" checked> Traveling tech staff (vs local)</label>
 </div>
 <a class="btn" href="${CONTACT}" target="_top">Get a Hippie Wrangler quote</a>
</section>
<section>
 <div class="card"><h3>Hardware plan</h3><div class="grid" id="hw"></div><p class="small">On-site days = show days + 2 (load-in and load-out).</p></div>
 <div id="big" class="note" style="display:none;margin-bottom:16px">Over 5,000 attendees: Hippie Wrangler is built for small–mid festivals. We can still support you; <a href="${CONTACT}" target="_top">request a custom quote</a> for accurate pricing.</div>
 <div class="card"><h3>Cost comparison by provider</h3><div style="overflow-x:auto"><table id="cmp"></table></div>
  <p class="small">Competitor figures are <b>estimates</b> from public quotes and industry benchmarks, not official pricing. Actual quotes vary by contract, region and volume. Hippie Wrangler software and hardware are priced in line with market baselines; RFID wristbands are 50% below the lowest competitor estimate.</p>
  <button class="btn" id="openBible">Generate on-site bible</button></div>
 <div class="card"><h3>Providers</h3><div id="provs"></div></div>
</section></main>
<div id="bible"><div class="box"><div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between"><h3 style="margin:0">Generated On-Site Bible</h3><button class="btn alt" id="x">Close</button></div>
<textarea id="bibleText" readonly></textarea>
<div class="bar"><button class="btn alt" id="print">Print</button><button class="btn alt" id="dl">Download .txt</button><button class="btn" id="copy">Copy to clipboard</button></div></div></div>
<script>
(function(){
var RATES={portal:1925,handheld:120,pos_tablet:85,staff_travel:600,staff_local:450,rfid_wristband:1.50,shipping_fulfillment:3.50,server_license:2500};
var COMP=[
 {name:"WRSTBND",band:1.50,hw:1.00,focus:"High-end custom / access / POS",pros:["Strong custom hardware (NTR-6 portals)","Integrated access & POS ecosystem","High-capacity capability (Soundstorm proven)","Real-time transparent reporting"],cons:["Premium pricing model","Requires robust on-site network for full features"],bestFor:"Large scale / high budget"},
 {name:"Intellitix",band:1.60,hw:1.00,focus:"Cashless & access veteran",pros:["Industry veteran with established track record","Works offline effectively","Strong cashless fraud prevention"],cons:["Older hardware aesthetic in some regions","Support can vary by region","Siloed data in older versions"],bestFor:"Established festivals"},
 {name:"Front Gate (Ticketmaster)",band:1.75,hw:1.15,focus:"Ticketing & access",pros:["Seamless Ticketmaster integration","Massive scale capabilities","Marketing & data reach"],cons:["Less flexible for custom on-site activations","POS often requires 3rd-party integration"],bestFor:"Ticketmaster-tied large events"},
 {name:"Connect & Go",band:1.65,hw:1.05,focus:"Cashless, access & activations",pros:["Flexible cashless + activations","Good sponsor/engagement tools","Mid-market friendly"],cons:["Smaller support footprint","Feature depth varies by package"],bestFor:"Mid-size festivals & venues"}];
var minBand=Math.min.apply(null,COMP.map(function(c){return c.band}));
var HW={name:"Hippie Wrangler (by Patron Journey)",band:+(minBand*0.5).toFixed(2),hw:1.00,featured:true,focus:"Affordable RFID access, cashless & check-in for independent festivals",pros:["RFID wristbands 50% below the lowest competitor estimate","Software + hardware priced at market baseline","Works with Patron Journey free ticketing & phone check-in","Hands-on support from festival people"],cons:["Built for under 5K attendees; larger events by custom quote"],bestFor:"Small–mid festivals under 5K"};
var PROVIDERS=[HW].concat(COMP);
var $=function(i){return document.getElementById(i)};
var money=function(n){return "$"+Math.round(n).toLocaleString("en-US")};
var num=function(id,min){var v=parseInt($(id).value,10);return isNaN(v)||v<min?min:v};
function inputs(){return{att:num("att",0),ven:num("ven",0),days:num("days",1),gates:num("gates",1),access:$("j_access").checked,cashless:$("j_cashless").checked,topup:$("j_topup").checked,ship:$("j_ship").checked,travel:$("j_travel").checked}}
function plan(i){
 var portals=i.access?Math.ceil(i.att/1200)*i.gates:0;
 var handhelds=i.access?i.gates*2+Math.ceil(i.att/1500):0;
 var pos=i.cashless?Math.ceil(i.ven*1.5)+5:0;
 var topups=i.cashless&&i.topup?Math.ceil(i.att/2000):0;
 var techs=Math.max(1,Math.ceil((portals+pos)/20));
 return{portals:portals,handhelds:handhelds,pos:pos,topups:topups,techs:techs,onsite:i.days+2};
}
function cost(p,i,h){
 var hwBase=h.portals*RATES.portal+h.handhelds*RATES.handheld*i.days+(h.pos+h.topups)*RATES.pos_tablet*i.days;
 var r={};
 r.hardware=hwBase*p.hw;
 r.license=RATES.server_license*p.hw;
 r.staff=h.techs*(i.travel?RATES.staff_travel:RATES.staff_local)*h.onsite;
 r.bands=i.att*p.band;
 r.ship=i.ship?i.att*RATES.shipping_fulfillment:0;
 r.total=r.hardware+r.license+r.staff+r.bands+r.ship;
 r.perHead=i.att?r.total/i.att:0;
 return r;
}
function render(){
 var i=inputs(),h=plan(i);
 $("hw").innerHTML=[["Access portals",h.portals],["Handheld scanners",h.handhelds],["POS tablets",h.pos],["Top-up stations",h.topups],["RFID techs",h.techs],["On-site days",h.onsite]].map(function(x){return '<div class="stat"><b>'+x[1]+'</b>'+x[0]+'</div>'}).join("");
 $("big").style.display=i.att>5000?"block":"none";
 var rows=[["Wristband rate","band"],["Hardware rental","hardware"],["Software license","license"],["Staffing","staff"],["RFID wristbands","bands"],["Shipping","ship"],["Total","total"],["Per attendee","perHead"]];
 var cs=PROVIDERS.map(function(p){return cost(p,i,h)});
 var t='<tr><th></th>'+PROVIDERS.map(function(p){return '<th>'+(p.featured?'<span style="color:var(--gold)">★ '+p.name+'</span>':p.name+' <span class="small">(est.)</span>')+'</th>'}).join("")+'</tr>';
 rows.forEach(function(r){t+='<tr'+(r[1]==="total"?' class="hw"':'')+'><td>'+r[0]+'</td>'+PROVIDERS.map(function(p,k){var v=r[1]==="band"?"$"+p.band.toFixed(2):r[1]==="perHead"?"$"+cs[k].perHead.toFixed(2):money(cs[k][r[1]]);return '<td'+(p.featured?' style="background:#fffaf0"':'')+'>'+v+'</td>'}).join("")+'</tr>'});
 var cheapestComp=Math.min.apply(null,cs.slice(1).map(function(c){return c.total}));
 t+='<tr><td>Savings vs lowest competitor</td><td style="background:#fffaf0;color:#2e7d32;font-weight:600">'+money(cheapestComp-cs[0].total)+'</td><td colspan="'+COMP.length+'"></td></tr>';
 $("cmp").innerHTML=t;
 window.__rfid={inputs:i,plan:h,costs:PROVIDERS.map(function(p,k){return{name:p.name,total:Math.round(cs[k].total)}})};
}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function bible(){
 var i=inputs(),h=plan(i),p=PROVIDERS[+$("prov").value||0],c=cost(p,i,h),L=[];
 L.push("EVENT TECH ON-SITE BIBLE","Generated "+new Date().toLocaleString(),"Provider: "+p.name+(p.featured?"":" (figures are estimates)"),"");
 L.push("== EVENT PROFILE ==","Attendees: "+i.att,"Vendors: "+i.ven,"Show days: "+i.days+" (on-site "+h.onsite+" incl. load-in/out)","Entry gates: "+i.gates,"");
 L.push("== PATRON JOURNEY ==","Access control: "+(i.access?"YES":"no"),"Cashless/POS: "+(i.cashless?"YES":"no"),"Top-up stations: "+(i.topup&&i.cashless?"YES":"no"),"Pre-mailed wristbands: "+(i.ship?"YES":"no (pickup at box office)"),"");
 L.push("== HARDWARE ==","Access portals: "+h.portals+" ("+(h.portals/i.gates)+" per gate)","Handheld scanners: "+h.handhelds,"POS tablets: "+h.pos+" ("+i.ven+" vendors x1.5 + 5 spares)","Top-up stations: "+h.topups,"RFID techs on site: "+h.techs+" ("+(i.travel?"traveling":"local")+")","");
 L.push("== BUDGET ==","Hardware rental: "+money(c.hardware),"Software license: "+money(c.license),"Staffing: "+money(c.staff),"Wristbands ("+i.att+" x $"+p.band.toFixed(2)+"): "+money(c.bands),"Shipping: "+money(c.ship),"TOTAL: "+money(c.total)+" ($"+c.perHead.toFixed(2)+"/attendee)","");
 L.push("== CHECKLIST ==","[ ] Confirm power + network at every gate and POS location","[ ] Wristband encoding + test batch 2 weeks out","[ ] Offline mode tested at gates","[ ] Vendor POS training before doors","[ ] Top-up / refund policy published","[ ] Daily cash/close-out reconciliation","[ ] Spare devices + chargers at tech HQ","");
 if(i.att>5000)L.push("NOTE: Over 5,000 attendees. Request a custom Hippie Wrangler quote.");
 L.push("Quotes: "+"${CONTACT}");
 return L.join("\n");
}
$("prov").innerHTML=PROVIDERS.map(function(p,k){return '<option value="'+k+'">'+esc(p.name)+'</option>'}).join("");
$("provs").innerHTML=PROVIDERS.map(function(p){return '<div class="prov'+(p.featured?' feat':'')+'"><h3 style="margin:0">'+esc(p.name)+(p.featured?' <span class="small">Featured</span>':'')+'</h3><div class="small">'+esc(p.focus)+' · Best for: <b>'+esc(p.bestFor)+'</b> · Wristbands $'+p.band.toFixed(2)+(p.featured?'':' (est.)')+'</div><div class="pc"><div><b style="color:#2e7d32;font-size:13px">Pros</b><ul>'+p.pros.map(function(x){return '<li>'+esc(x)+'</li>'}).join("")+'</ul></div><div><b style="color:#b23b3b;font-size:13px">Cons</b><ul>'+p.cons.map(function(x){return '<li>'+esc(x)+'</li>'}).join("")+'</ul></div></div>'+(p.featured?'<a class="btn" target="_top" href="${CONTACT}">Get a Hippie Wrangler quote</a>':'')+'</div>'}).join("");
document.querySelectorAll("input,select").forEach(function(e){e.addEventListener("input",render);e.addEventListener("change",render)});
$("openBible").onclick=function(){$("bibleText").value=bible();$("bible").style.display="flex"};
$("x").onclick=function(){$("bible").style.display="none"};
$("copy").onclick=function(){var t=$("bibleText");(navigator.clipboard?navigator.clipboard.writeText(t.value):Promise.reject()).then(function(){$("copy").textContent="Copied!"},function(){t.select();document.execCommand("copy");$("copy").textContent="Copied!"})};
$("print").onclick=function(){window.print()};
$("dl").onclick=function(){var b=new Blob([$("bibleText").value],{type:"text/plain"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="onsite-bible.txt";document.body.appendChild(a);a.click();a.remove()};
render();
})();
</script></body></html>`;
}
