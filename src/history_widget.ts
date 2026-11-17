/**
 * Shared "Your historic shows" widget (GET /pj-history.js), used by /talent and the Festival Simulator.
 * Paste CSV/TSV (straight from Excel/Sheets) or upload .csv/.tsv/.xlsx. Signed-in organizers: rows are saved
 * privately in D1 (/api/talent/history). Signed out: rows stay in this browser (localStorage "pj_talent_history_v1").
 * window.PJHistory.mount(el, { onChange(rows) }) -> { rows() }
 */
export function historyJs(origin: string): string {
  return `/* Patron Journey historic shows widget (src/history_widget.ts) */
(function(){
if (window.PJHistory) return;
var O = ${JSON.stringify(origin)}, LS = 'pj_talent_history_v1';
var COLS = ['artist','city','date','venue','capacity','tickets_sold','gross','fee_paid'];
var ALIAS = { artist:/^(artist|act|performer|band|headliner|name)$/, city:/^(city|market|location|town)$/, date:/^(date|show ?date|event ?date|day)$/, venue:/^(venue|room|place)$/,
  capacity:/^(capacity|cap|venue ?capacity)$/, tickets_sold:/^(tickets?( ?sold)?|sold|paid( ?attendance)?|attendance|draw|scans?)$/, gross:/^(gross|revenue|box ?office|ticket ?revenue|sales)$/, fee_paid:/^(fee|fee ?paid|artist ?fee|guarantee|cost|talent ?cost)$/ };
var css = '.pjh{font-size:14px}.pjh textarea{width:100%;min-height:90px;font:13px/1.4 ui-monospace,monospace;padding:8px;border:1px solid #e4dccb;border-radius:6px;background:#fff;color:#2B2620}'
 + '.pjh .pjh-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}.pjh button,.pjh .pjh-file{background:#B8932E;color:#fff;border:0;border-radius:6px;padding:7px 12px;font:600 13px Helvetica,Arial,sans-serif;cursor:pointer}'
 + '.pjh button.alt,.pjh .pjh-file{background:#fff;color:#B8932E;border:1px solid #B8932E}.pjh .pjh-file input{display:none}.pjh small,.pjh .pjh-st{color:#6B6257}'
 + '.pjh table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}.pjh td,.pjh th{padding:4px;border-bottom:1px solid #e4dccb;text-align:left}.pjh .x{background:none;color:#a33;border:0;padding:0 4px;font-size:15px}'
 + '.pjh .pjh-wrap{max-height:260px;overflow:auto}.pjh .pjh-msg{font-size:13px;margin-top:4px}';
var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]}); }
function splitLine(line, d){ if (d !== ',') return line.split(d); var out=[], cur='', q=false; for (var i=0;i<line.length;i++){ var c=line[i]; if(q){ if(c==='"'&&line[i+1]==='"'){cur+='"';i++;} else if(c==='"') q=false; else cur+=c; } else if(c==='"') q=true; else if(c===','){out.push(cur);cur='';} else cur+=c; } out.push(cur); return out; }
function parseText(text){
  var lines = String(text||'').replace(/\\r/g,'').split('\\n').filter(function(l){return l.trim();}); if (!lines.length) return [];
  var d = lines[0].indexOf('\\t')>=0 ? '\\t' : lines[0].indexOf('|')>=0 ? '|' : lines[0].indexOf(';')>=0 && lines[0].indexOf(',')<0 ? ';' : ',';
  return toRows(lines.map(function(l){ return splitLine(l, d).map(function(x){return x.trim();}); }));
}
function toRows(grid){
  if (!grid.length) return [];
  var head = grid[0].map(function(h){ return String(h==null?'':h).toLowerCase().replace(/[_\\-]+/g,' ').replace(/[^a-z ]/g,'').trim(); });
  var map = {}, hits = 0;
  head.forEach(function(h,i){ for (var k in ALIAS) if (map[k]==null && ALIAS[k].test(h)) { map[k]=i; hits++; break; } });
  var body = grid;
  if (hits >= 2 && map.artist != null) body = grid.slice(1); else { map = {}; COLS.forEach(function(c,i){ map[c]=i; }); }
  return body.map(function(r){ var o = {}; COLS.forEach(function(c){ var v = map[c]!=null ? r[map[c]] : null; o[c] = v==null||v==='' ? null : v; });
    if (o.date instanceof Date) o.date = o.date.toISOString().slice(0,10);
    ['capacity','tickets_sold','gross','fee_paid'].forEach(function(k){ if (o[k]!=null){ var n = Number(String(o[k]).replace(/[$,\\s]/g,'')); o[k] = isFinite(n) ? n : null; } });
    return o; }).filter(function(o){ return o.artist && (o.tickets_sold!=null || o.fee_paid!=null); });
}
function loadXlsx(cb){ if (window.XLSX) return cb(); var s = document.createElement('script'); s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'; s.onload = cb; s.onerror = function(){ cb(new Error('Could not load the Excel reader. Save the sheet as CSV and upload that instead.')); }; document.head.appendChild(s); }
function readFile(f, cb){
  if (/\\.xlsx?$/i.test(f.name)) { loadXlsx(function(err){ if (err) return cb(err); var fr = new FileReader(); fr.onload = function(){ try { var wb = XLSX.read(fr.result, { type:'array', cellDates:true }); var ws = wb.Sheets[wb.SheetNames[0]]; cb(null, toRows(XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:null }))); } catch(e){ cb(e); } }; fr.readAsArrayBuffer(f); }); }
  else { var fr = new FileReader(); fr.onload = function(){ cb(null, parseText(fr.result)); }; fr.readAsText(f); }
}
var TEMPLATE = 'artist,city,date,venue,capacity,tickets_sold,gross,fee_paid\\nExample Band,"Houston, TX",2025-10-18,White Oak Music Hall,2500,1840,73600,18000\\n';
function mount(el, opt){
  opt = opt || {}; var rows = [], mode = 'local', who = '';
  el.classList.add('pjh');
  el.innerHTML = '<div class="pjh-st"></div>'
   + '<textarea placeholder="Paste rows from Excel or Google Sheets (with a header row), or CSV:\\nartist, city, date, venue, capacity, tickets_sold, gross, fee_paid"></textarea>'
   + '<div class="pjh-bar"><button type="button" class="pjh-add">Add pasted rows</button><label class="pjh-file">Upload CSV / XLSX<input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls"></label>'
   + '<a href="data:text/csv;charset=utf-8,'+encodeURIComponent(TEMPLATE)+'" download="pj-historic-shows-template.csv">Download template</a>'
   + '<button type="button" class="alt pjh-sync" hidden></button><button type="button" class="alt pjh-clear">Clear all</button></div>'
   + '<div class="pjh-msg"></div><div class="pjh-wrap"></div>'
   + '<small>Use shows where the act headlined. Columns: artist, city ("Austin, TX"), date, venue, capacity, tickets sold, gross $, fee paid $. Each row needs tickets sold or fee paid. Rows from the last 5 years count; 3–5-year-old rows count at 85%.</small>';
  var q = function(s){ return el.querySelector(s); };
  function msg(t, bad){ q('.pjh-msg').innerHTML = '<span style="color:'+(bad?'#a33':'#2e7d32')+'">'+esc(t)+'</span>'; }
  function status(){ q('.pjh-st').innerHTML = mode === 'account' ? '<b>Saved privately to your organizer account</b> ('+esc(who)+'). Only you can see these rows.' : '<b>Saved in this browser only.</b> <a href="'+O+'/dashboard" target="_top">Sign in to the organizer dashboard</a> to keep them in your account.'; }
  function local(){ try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch(e){ return []; } }
  function saveLocal(r){ try { localStorage.setItem(LS, JSON.stringify(r.slice(0, 500))); } catch(e){} }
  function render(){
    var sync = q('.pjh-sync'), loc = local();
    if (mode === 'account' && loc.length) { sync.hidden = false; sync.textContent = 'Move '+loc.length+' browser rows to my account'; } else sync.hidden = true;
    q('.pjh-wrap').innerHTML = rows.length ? '<table><tr><th>Artist</th><th>City</th><th>Date</th><th>Cap</th><th>Sold</th><th>Gross</th><th>Fee</th><th></th></tr>' + rows.slice(0, 200).map(function(r, i){ return '<tr><td>'+esc(r.artist)+'</td><td>'+esc(r.city)+'</td><td>'+esc(r.date)+'</td><td>'+esc(r.capacity)+'</td><td>'+esc(r.tickets_sold)+'</td><td>'+esc(r.gross)+'</td><td>'+esc(r.fee_paid)+'</td><td><button type="button" class="x" data-i="'+i+'" title="Remove">×</button></td></tr>'; }).join('') + '</table>' + (rows.length > 200 ? '<small>Showing 200 of '+rows.length+'.</small>' : '') : '<small>No historic shows yet.</small>';
    status(); if (opt.onChange) opt.onChange(rows.slice());
  }
  function api(method, path, body){ return fetch(O + '/api/talent/history' + (path||''), { method: method, credentials: 'include', headers: Object.assign({ 'content-type': 'application/json' }, (function(){ try { var t = sessionStorage.getItem('pj_token'); return t ? { authorization: 'Bearer ' + t } : {}; } catch(e){ return {}; } })()), body: body ? JSON.stringify(body) : undefined }).then(function(r){ return r.json().then(function(j){ if (!r.ok) { var e = new Error(j.message || ('HTTP '+r.status)); e.status = r.status; throw e; } return j; }); }); }
  function refresh(){ return api('GET').then(function(j){ mode = 'account'; who = j.organizer || ''; rows = j.rows || []; render(); }, function(){ mode = 'local'; rows = local(); render(); }); }
  function add(newRows){
    if (!newRows.length) { msg('No usable rows found. Each row needs an artist and tickets sold or fee paid.', true); return; }
    if (mode === 'account') api('POST', '', { rows: newRows }).then(function(j){ msg('Saved '+j.added+' rows to your account'+(j.dropped?' ('+j.dropped+' skipped)':'')+'.'); refresh(); }, function(e){ msg(e.message, true); });
    else { rows = rows.concat(newRows).slice(0, 500); saveLocal(rows); msg('Added '+newRows.length+' rows (saved in this browser).'); render(); }
  }
  q('.pjh-add').onclick = function(){ add(parseText(q('textarea').value)); q('textarea').value = ''; };
  q('input[type=file]').onchange = function(ev){ var f = ev.target.files[0]; if (!f) return; readFile(f, function(err, r){ if (err) msg(err.message || String(err), true); else add(r); ev.target.value = ''; }); };
  q('.pjh-clear').onclick = function(){ if (!rows.length || !confirm('Delete all '+rows.length+' historic rows'+(mode==='account'?' from your account':'')+'?')) return;
    if (mode === 'account') api('DELETE', '?id=all').then(refresh, function(e){ msg(e.message, true); }); else { rows = []; saveLocal(rows); render(); } };
  q('.pjh-sync').onclick = function(){ var loc = local(); api('POST', '', { rows: loc }).then(function(j){ saveLocal([]); msg('Moved '+j.added+' rows to your account.'); refresh(); }, function(e){ msg(e.message, true); }); };
  q('.pjh-wrap').onclick = function(ev){ var b = ev.target.closest('.x'); if (!b) return; var r = rows[Number(b.getAttribute('data-i'))]; if (!r) return;
    if (mode === 'account' && r.id) api('DELETE', '?id=' + r.id).then(refresh, function(e){ msg(e.message, true); }); else { rows.splice(Number(b.getAttribute('data-i')), 1); saveLocal(rows); render(); } };
  rows = local(); render(); refresh();
  return { rows: function(){ return rows.map(function(r){ return { artist:r.artist, city:r.city, date:r.date, venue:r.venue, capacity:r.capacity, tickets_sold:r.tickets_sold, gross:r.gross, fee_paid:r.fee_paid }; }); }, mode: function(){ return mode; } };
}
window.PJHistory = { mount: mount, parse: parseText };
})();
`;
}
