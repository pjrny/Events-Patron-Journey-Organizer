/* Patron Journey · Event Bible filler (event-bible.v1)
 * Fills ONLY the "Inputs" sheet of an openpyxl-built template by editing its XML,
 * so styles, formulas, print setup and validations survive. Runs fully in the browser:
 * the user's data never leaves the device. Needs fflate (window.fflate or require("fflate")).
 */
(function (root) {
  "use strict";
  var STATE_KEY = "pj_event_bible_state_v1";
  var fflate = root.fflate || (typeof require === "function" ? (function () { try { return require("./fflate.min.js"); } catch (e) { return null; } })() : null);

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; })
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  }
  function dateSerial(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
    if (!m) return null;
    return (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000;
  }
  function timeFrac(v) {
    if (typeof v === "number") return v;
    var m = /^(\d{1,2}):(\d{2})/.exec(String(v || ""));
    if (!m) return null;
    return ((+m[1]) * 60 + (+m[2])) / 1440;
  }
  function cellXml(ref, style, type, value) {
    var s = style ? ' s="' + style + '"' : "";
    if (value === null || value === undefined || value === "") return '<c r="' + ref + '"' + s + "/>";
    var num = null;
    if (type === "date") num = dateSerial(value);
    else if (type === "time") num = timeFrac(value);
    else if (type === "number" || type === "money" || type === "pct") num = Number(value);
    if (type === "yn") value = value === true || /^(y|yes|true|1)$/i.test(String(value)) ? "Y" : "N";
    if (num !== null && isFinite(num) && type !== "text" && type !== "yn") return '<c r="' + ref + '"' + s + "><v>" + (type === "money" || type === "number" ? (Math.round(num * 1e6) / 1e6) : num) + "</v></c>";
    if (num !== null && !isFinite(num)) return '<c r="' + ref + '"' + s + "/>";
    var txt = String(value).slice(0, 32000);
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(txt) + "</t></is></c>";
  }
  function setCell(xml, ref, type, value, missing) {
    var re = new RegExp('<c r="' + ref + '"([^>]*?)(/>|>[\\s\\S]*?</c>)');
    var hit = false;
    var out = xml.replace(re, function (all, attrs) {
      hit = true;
      var sm = /\ss="(\d+)"/.exec(attrs);
      return cellXml(ref, sm ? sm[1] : null, type, value);
    });
    if (!hit) missing.push(ref);
    return out;
  }
  function inputsPath(files) {
    var dec = fflate.strFromU8;
    var wbx = dec(files["xl/workbook.xml"]);
    var m = /<sheet[^>]*name="Inputs"[^>]*r:id="([^"]+)"/.exec(wbx) || /<sheet[^>]*r:id="([^"]+)"[^>]*name="Inputs"/.exec(wbx);
    if (!m) throw new Error("Inputs sheet not found");
    var rels = dec(files["xl/_rels/workbook.xml.rels"]);
    var rm = new RegExp('<Relationship[^>]*Id="' + m[1] + '"[^>]*Target="([^"]+)"').exec(rels) || new RegExp('<Relationship[^>]*Target="([^"]+)"[^>]*Id="' + m[1] + '"').exec(rels);
    var t = rm[1].replace(/^\/?xl\//, "").replace(/^\//, "");
    return "xl/" + t;
  }

  /** fill(xlsx ArrayBuffer|Uint8Array, data {scalars, tables}, fieldMap) -> Uint8Array */
  function fill(buf, data, fieldMap) {
    if (!fflate) throw new Error("fflate not loaded");
    var files = fflate.unzipSync(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
    var path = inputsPath(files);
    var xml = fflate.strFromU8(files[path]);
    var missing = [];
    var sc = (data && data.scalars) || {};
    Object.keys(fieldMap.scalars).forEach(function (k) {
      if (!(k in sc)) return;
      var f = fieldMap.scalars[k];
      xml = setCell(xml, f.cell, f.type, sc[k], missing);
    });
    var tb = (data && data.tables) || {};
    Object.keys(fieldMap.tables).forEach(function (name) {
      var spec = fieldMap.tables[name], rows = tb[name];
      if (!rows || !rows.length) return;
      rows.slice(0, spec.max_rows).forEach(function (row, i) {
        Object.keys(spec.columns).forEach(function (col) {
          if (!(col in row)) return;
          var c = spec.columns[col];
          xml = setCell(xml, c.col + (spec.first_row + i), c.type, row[col], missing);
        });
      });
    });
    files[path] = fflate.strToU8(xml);
    if (missing.length && root.console) console.warn("EventBible: cells not found", missing.slice(0, 10));
    return fflate.zipSync(files, { level: 6 });
  }

  // ------------------------------------------------------------ mapping
  function localStamp() {
    var d = new Date(), z = function (n) { return ("0" + n).slice(-2); };
    var tz = ""; try { tz = " " + (Intl.DateTimeFormat().resolvedOptions().timeZone || ""); } catch (e) {}
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes()) + tz;
  }
  function num(v) { if (v === null || v === undefined || v === "") return null; var n = Number(v); return isFinite(n) ? n : null; }
  function minutesBetween(a, b) {
    var x = timeFrac(a), y = timeFrac(b);
    if (x == null || y == null) return null;
    var d = y - x; if (d <= 0) d += 1;
    return Math.round(d * 24 * 10) / 10;
  }
  function parseLineup(text) {
    return String(text || "").split(/\n+/).map(function (l) {
      var p = l.split("|"); var name = p[0].trim();
      if (!name) return null;
      var fee = p[1] ? Number(String(p[1]).replace(/[^0-9.]/g, "")) : null;
      return { name: name, fee: isFinite(fee) && fee > 0 ? fee : null };
    }).filter(Boolean);
  }
  function addMin(t, m) { var f = timeFrac(t); if (f == null) return null; var x = Math.round(f * 1440 + m); x = ((x % 1440) + 1440) % 1440; return ("0" + Math.floor(x / 60)).slice(-2) + ":" + ("0" + (x % 60)).slice(-2); }

  /** Draft a schedule: acts spread across days, best-ranked last on the main stage. Edit in the file. */
  function draftLineup(acts, stages, days, gatesOpen, gatesClose) {
    days = Math.max(1, days || 1);
    var byDay = {}; acts.forEach(function (a, i) { var d = (i % days) + 1; (byDay[d] = byDay[d] || []).push(a); });
    var out = [];
    Object.keys(byDay).forEach(function (d) {
      var list = byDay[d].slice().reverse(); // weakest first
      var perStage = {}; list.forEach(function (a, i) {
        var isTop = i >= list.length - Math.min(2, list.length);
        var st = isTop || stages.length < 2 ? stages[0] : stages[1 + (i % (stages.length - 1))];
        (perStage[st] = perStage[st] || []).push(a);
      });
      Object.keys(perStage).forEach(function (st) {
        // Schedule backwards from curfew so the strongest act closes each stage.
        var list2 = perStage[st], end = gatesClose || null, slots = [];
        for (var j = list2.length - 1; j >= 0; j--) {
          var top = j === list2.length - 1 && st === stages[0];
          var len = top ? 90 : 60;
          var start = end ? addMin(end, -len) : null;
          slots.unshift({ a: list2[j], start: start, len: len });
          if (start) end = addMin(start, -15);
        }
        slots.forEach(function (x) {
          var a = x.a;
          out.push({ artist: a.name, day: +d, stage: st, start: x.start, length: x.len, tier: a.tier, draw: a.draw, suggested_fee: a.suggested_fee, offer: a.offer, agency: null });
        });
      });
    });
    return out;
  }

  function budgetLines(model, budget) {
    if (!model || !budget || !root.BudgetEngine || !BudgetEngine.lineCost) return [];
    var ctx = { revenue: budget.K22, k2: budget.K2, ccFeeRate: (model.defaults || {}).cc_fee_rate, N0: model.baseline && model.baseline.N0 };
    var rows = [];
    (model.departments || []).forEach(function (d) {
      var ls = (d.lines || []).map(function (l) { return { l: l, v: BudgetEngine.lineCost(l, budget.N, ctx) || 0 }; });
      var sum = ls.reduce(function (s, x) { return s + x.v; }, 0);
      var target = budget.departments && budget.departments[d.id];
      var k = sum > 0 && target != null ? target / sum : 1;
      ls.forEach(function (x) {
        rows.push({ dept: d.id, item: String(x.l.label || "").trim(), amount: Math.round(x.v * k), fixed: x.l.type === "fixed" && !x.l.scale_with_N ? "Y" : "N", note: k !== 1 && Math.abs(k - 1) > 0.001 ? "scaled to sim dept total" : "" });
      });
    });
    ((budget.rfid && budget.rfid_enabled && budget.rfid.lines) || []).forEach(function (l) { rows.push({ dept: "rfid", item: l.label, amount: Math.round(l.extended || 0), fixed: "N", note: "" }); });
    ((budget.safety_weather && budget.safety_weather_enabled && budget.safety_weather.lines) || []).forEach(function (l) { rows.push({ dept: "safety", item: l.label, amount: Math.round(l.extended || 0), fixed: /flat|pct/.test(l.unit || "") ? "Y" : "N", note: l.unit || "" }); });
    return rows;
  }

  /** fromSimulator({form, budget, model, talent, lineupText, talentBudget, weather, mc, ros, mode}) -> data */
  function fromSimulator(o) {
    o = o || {};
    var f = o.form || {}, p = f.profile || {}, op = f.options || {}, sw = f.safetyWeather || {}, rf = f.rfid || {}, b = o.budget || {}, w = o.weather || null;
    var days = num(sw.show_days) || (p.start_date && p.end_date ? Math.round((dateSerial(p.end_date) - dateSerial(p.start_date)) + 1) : null);
    var peak = num(sw.peak_occupancy) || num(op.N);
    var secLine = ((b.safety_weather && b.safety_weather.lines) || []).filter(function (l) { return l.id === "security_per_100"; })[0];
    var sc = {
      data_mode: o.mode || "YOUR DATA — from Festival Forecaster",
      generated_at: localStamp(),
      event_name: p.name, organizer: p.organizer, event_type: [p.type, p.subtype].filter(Boolean).join(" / "), genre: p.genre,
      venue: p.venue, street: p.street, city: p.city, state: p.state, zip: p.zip, timezone: p.timezone,
      start_date: p.start_date, end_date: p.end_date, show_days: days, load_in_days: num(sw.load_in_days),
      gates_open: p.start_time, gates_close: p.end_time, gate_hours: minutesBetween(p.start_time, p.end_time),
      attendance: num(op.N), peak_occupancy: peak, capacity_limit: p.limit_registrations,
      camping: p.camping ? "Y" : "N", camping_pct: p.camping ? num(op.p_camp) : 0,
      ticket_price: num(op.ticket), camp_fee: p.camping ? num(op.camp_fee) : null,
      avg_revenue_per_head: num(b.K23), ticket_revenue: num(b.K22),
      ancillary_revenue: (num(b.ancTotal) || 0) + (num(b.sponsors_booths_income) || 0),
      total_opex: num(b.total_opex), net_profit: num(b.K47), break_even_price: num(b.K2),
      talent_budget: num(o.talentBudget) || (b.departments ? num(b.departments.talent) : null),
      production_budget: b.departments ? num(b.departments.production) : null,
      marketing_budget: b.departments ? num(b.departments.marketing) : null,
      mc_p_profit: o.mc ? num(o.mc.pProfit) : null,
      cashless_mode: rf.enabled ? rf.cashlessMode : "none", rfid_enabled: rf.enabled ? "Y" : "N", rfid_subtotal: b.rfid_enabled ? num(b.rfid_subtotal) : null,
      venue_mode: sw.venue_mode, hospital_minutes: num(sw.nearest_hospital_minutes), fire_permit: sw.ahj_fire_permit_status,
      security_staff: secLine && days ? Math.round(secLine.qty / days) : null,
      safety_subtotal: b.safety_weather_enabled ? num(b.safety_weather_subtotal) : null,
    };
    if (sw.lightning_stand_down_miles) sc.lightning_miles = num(sw.lightning_stand_down_miles);
    if (sw.wind_hold_mph) sc.wind_hold_mph = num(sw.wind_hold_mph);
    if (w && w.ok) {
      var h = w.history || {};
      sc.weather_score = w.risk && w.risk.score; sc.weather_label = w.risk && w.risk.label;
      sc.rain_pct = h.rain && h.rain.pct; sc.storm_pct = h.storms && h.storms.pct; sc.wind_hold_pct = h.wind && h.wind.hold_pct;
      sc.heat_pct = h.heat && h.heat.pct; sc.cold_pct = h.cold && h.cold.pct;
      sc.avg_high_f = h.temps && h.temps.avg_high_f; sc.avg_low_f = h.temps && h.temps.avg_low_f;
      sc.weather_link = w.permalink ? (o.origin || "") + w.permalink : null;
    }
    // stages
    var stageNames = [];
    (o.ros || []).forEach(function (r) { if (r && /stage/i.test(r.area || "") && stageNames.indexOf(r.area) < 0) stageNames.push(r.area); });
    var plan = o.stagesCount || 3;
    ["Main Stage", "Stage 2", "Stage 3"].slice(0, plan).forEach(function (s) { if (stageNames.length < plan && stageNames.indexOf(s) < 0) stageNames.push(s); });
    var stages = stageNames.slice(0, 10).map(function (n, i) { return { name: n, type: i === 0 ? "Main" : "Secondary", capacity: i === 0 ? peak : null, open: p.start_time, close: p.end_time }; });
    // lineup
    var acts = [];
    var t = o.talent;
    var given = parseLineup(o.lineupText);
    if (t && t.pay && t.pay.per_artist) {
      var draws = {}; (t.artists || []).forEach(function (a) { draws[a.name] = a.draw && a.draw.mid; });
      t.pay.per_artist.slice().sort(function (a, c) { return a.rank - c.rank; }).forEach(function (a) {
        var g = given.filter(function (x) { return x.name.toLowerCase() === String(a.name).toLowerCase(); })[0];
        acts.push({ name: a.name, rank: a.rank, draw: draws[a.name], suggested_fee: a.suggested_fee, offer: g && g.fee });
      });
    } else {
      given.forEach(function (g, i) { acts.push({ name: g.name, rank: i + 1, offer: g.fee }); });
    }
    var d = days || 1;
    acts.forEach(function (a) { a.tier = a.rank <= d ? "Tier 1" : a.rank <= 3 * d ? "Tier 2" : "Tier 3"; });
    var lineup = draftLineup(acts.slice(0, 60), stageNames, d, p.start_time, p.end_time);
    var tables = {
      stages: stages,
      lineup: lineup,
      budget: budgetLines(o.model, b),
      rfid: ((b.rfid_enabled && b.rfid && b.rfid.lines) || []).map(function (l) { return { id: l.id, item: l.label, unit_price: l.unit_price, qty: l.qty, unit: "ea" }; }),
      safety: ((b.safety_weather_enabled && b.safety_weather && b.safety_weather.lines) || []).map(function (l) { return { id: l.id, item: l.label, unit_price: l.unit_price, qty: l.qty, unit: l.unit }; }),
    };
    Object.keys(sc).forEach(function (k) { if (sc[k] === undefined) delete sc[k]; });
    return { schema: "pj-event-bible-data.v1", mode: sc.data_mode, scalars: sc, tables: tables };
  }

  function blankData() { return { mode: "BLANK TEMPLATE", scalars: { data_mode: "BLANK TEMPLATE — no event data" }, tables: {} }; }

  function saveState(data) { try { localStorage.setItem(STATE_KEY, JSON.stringify(Object.assign({ saved_at: new Date().toISOString() }, data))); return true; } catch (e) { return false; } }
  function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY) || "null"); } catch (e) { return null; } }

  function slug(s) { return String(s || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "event"; }
  function saveBlob(bytes, name) {
    var blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  var fmCache = {};
  function getJSON(url) { if (!fmCache[url]) fmCache[url] = fetch(url).then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }); return fmCache[url]; }

  /** download(id, data, {base}) — id = "event-bible" or a template id; base = folder holding field_map.json */
  function download(id, data, opts) {
    opts = opts || {}; var base = (opts.base || "./").replace(/\/?$/, "/");
    return getJSON(base + "field_map.json").then(function (fm) {
      var file = fm.files[id]; if (!file) throw new Error("unknown template " + id);
      return fetch(base + file.path).then(function (r) { if (!r.ok) throw new Error(file.path + " " + r.status); return r.arrayBuffer(); }).then(function (buf) {
        var bytes = data ? fill(buf, data, fm) : new Uint8Array(buf);
        var kind = !data ? "blank" : /SAMPLE/i.test(data.mode || "") ? "sample" : "filled";
        var nm = (kind === "blank" ? "" : slug(data.scalars && data.scalars.event_name) + "-") + id + "-" + kind + ".xlsx";
        if (opts.returnBytes) return { bytes: bytes, name: nm };
        saveBlob(bytes, nm); return { name: nm, size: bytes.length };
      });
    });
  }

  root.EventBible = { fill: fill, fromSimulator: fromSimulator, blankData: blankData, saveState: saveState, loadState: loadState, download: download, STATE_KEY: STATE_KEY, version: "event-bible.v1" };
  if (typeof module !== "undefined" && module.exports) module.exports = root.EventBible;
})(typeof window !== "undefined" ? window : globalThis);
