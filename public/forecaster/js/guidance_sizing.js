/* v1.6 · Published-guidance sizing readout under Safety / Weather (display only; never changes dollars).
 * Same formulas as the Event Bible "Safety Metrics" tab. Sources: Purple Guide ch.18 Table 1 & ch.5 (Dec 2024),
 * SGSA Green Guide / stewarding, NSW Health mass-gathering water, WA Health 2022, A Greener Festival 2024. */
(function () {
  "use strict";
  var G = {
    toilets: function (hours, alcohol) { return hours < 6 ? { f: 100, m: 500, u: 150, row: "gates open under 6 h" } : alcohol ? { f: 75, m: 400, u: 100, row: "6 h+, food & alcohol" } : { f: 85, m: 425, u: 125, row: "6 h+, little food/alcohol" }; },
    camp: { f: 75, m: 150, u: 250 },
    medicalTier: function (n) { return n < 500 ? 1 : n <= 2000 ? 2 : n <= 5000 ? 3 : n <= 10000 ? 4 : 5; },
    stewardsPer: 250, waterDayL: 4, waterCampL: 20, outletPer: 1000, wasteDayKg: 0.5, wasteCampKg: 1.4,
  };
  function hrs(a, b) { var m = /^(\d+):(\d+)/, x = m.exec(a || ""), y = m.exec(b || ""); if (!x || !y) return 11; var d = (+y[1] * 60 + +y[2]) - (+x[1] * 60 + +x[2]); if (d <= 0) d += 1440; return d / 60; }
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
  function render(r) {
    var el = document.getElementById("guidanceSizing");
    if (!el || typeof window.__ffReadForm !== "function") return;
    var f = window.__ffReadForm(), sw = f.safetyWeather || {}, p = f.profile || {}, o = f.options || {};
    var peak = Number(sw.peak_occupancy) || Number(o.N) || 0; if (!peak) { el.innerHTML = ""; return; }
    var days = Math.max(1, Number(sw.show_days) || 1), h = hrs(p.start_time, p.end_time), t = G.toilets(h, true);
    var campers = p.camping ? Math.round(peak * (Number(o.p_camp) || 0)) : 0, fem = peak / 2, mal = peak / 2;
    var toilets = Math.ceil(fem / t.f) + Math.ceil(mal / t.m) + (campers ? Math.ceil(campers / 2 / G.camp.f) + Math.ceil(campers / 2 / G.camp.m) : 0) + Math.max(1, Math.ceil(peak / 1000));
    var urinals = Math.ceil(mal / t.u) + (campers ? Math.ceil(campers / 2 / G.camp.u) : 0);
    var water = (peak - campers) * G.waterDayL * days + campers * G.waterCampL * days;
    var waste = (peak - campers) * G.wasteDayKg * days + campers * G.wasteCampKg * days;
    var sec = r && r.safety_weather && (r.safety_weather.lines || []).filter(function (l) { return l.id === "security_per_100"; })[0];
    var rows = [
      ["Toilets (incl. accessible)", fmt(toilets) + " + " + fmt(urinals) + " urinals", "Purple Guide ch.18 Table 1 (" + t.row + (campers ? "; campsite 1:75 F / 1:150 M" : "") + "), 50:50 split"],
      ["Medical tier", "Tier " + G.medicalTier(peak), "Purple Guide ch.5 (Dec 2024); a Medical Needs Assessment sets cover"],
      ["Mobile stewards (floor)", fmt(Math.ceil(peak / G.stewardsPer)) + (sec ? " · sim budgets " + fmt(sec.qty / days) + " security units/day" : ""), "SGSA ~1 per 250; risk assessment decides"],
      ["Drinking water", fmt(water) + " L (" + fmt(water / 3.785) + " gal)", "NSW Health: 4 L/person/day; 20 L camping"],
      ["Free water outlets", fmt(Math.ceil(peak / G.outletPer)), "WA Health 2022: 1 per 1,000"],
      ["Waste", fmt(waste) + " kg", "AGF 2024: 0.5 kg/person/day; 1.4 kg camping"],
    ];
    el.innerHTML = '<h3 style="font-size:0.8rem;color:var(--muted);margin:0.75rem 0 0.25rem">Sizing from published guidance <span class="cell-ref">display only</span></h3>' +
      '<table class="pnl rfid-qty"><thead><tr><th>Item</th><th class="num">Planning floor</th><th>Source</th></tr></thead><tbody>' +
      rows.map(function (x) { return "<tr><td>" + x[0] + '</td><td class="num">' + x[1] + '</td><td style="font-size:0.78rem;color:var(--muted)">' + x[2] + "</td></tr>"; }).join("") +
      '</tbody></table><p class="footer-note" style="text-align:left;padding:0.25rem 0">Assumes ' + h.toFixed(1) + " gate hours/day, food & alcohol served. Full workings in the Event Bible → Safety Metrics tab. Your licensing authority, fire marshal and medical provider set the final numbers.</p>";
  }
  document.addEventListener("ff:recalc", function (e) { try { render(e.detail); } catch (err) {} });
  window.GuidanceSizing = { G: G, render: render };
})();
