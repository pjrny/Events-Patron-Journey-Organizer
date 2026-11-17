/**
 * v1.5 Lineup, artist pay & date effects for the Festival Forecaster.
 * Calls the Patron Journey Worker (same API as /talent):
 *   POST {WORKER_BASE}/api/talent/draw   -> talent-draw.v2 (draw per act, date effects, pay estimate)
 *   GET  {WORKER_BASE}/api/date-effects  -> date-effects.v1 (weekday / holiday / going-out days)
 *   {WORKER_BASE}/pj-history.js          -> shared "historic shows" widget (D1 when signed in, else localStorage)
 * Attendance N is only changed when the user clicks an "Apply" button; nothing is applied silently.
 */
(function () {
  "use strict";
  var CFG = Object.assign({ WORKER_BASE: "https://events-patronjourney.message-0ad.workers.dev" }, window.FORECASTER_CONFIG || {});
  var BASE = String(CFG.WORKER_BASE || "").replace(/\/+$/, "");
  var LS = "ff_lineup_v1";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var n = function (x) { return x == null ? "–" : Number(x).toLocaleString("en-US"); };
  var money = function (x) { return x == null ? "–" : "$" + Number(x).toLocaleString("en-US"); };
  var TZ_CC = { "America/Toronto": "CA", "America/Vancouver": "CA", "America/Mexico_City": "MX", "Europe/London": "GB", "Europe/Berlin": "DE", "Europe/Amsterdam": "NL", "Europe/Madrid": "ES", "Australia/Sydney": "AU", "Asia/Tokyo": "JP" };
  var hist = null, last = null, lastDates = null, applied = null, baseN = null, programmatic = false;

  function country() { var tz = $("timezone") && $("timezone").value; return TZ_CC[tz] || "US"; }
  function val(id) { var el = $(id); return el ? String(el.value || "").trim() : ""; }
  function cityStr() { var c = val("city"), s = val("state"); return c ? c + (s ? ", " + s : "") : ""; }
  function capacity() { return $("limitRegEnabled") && $("limitRegEnabled").checked && val("limitRegistrations") ? Number(val("limitRegistrations")) : null; }
  function setN(v, mode) {
    var el = $("attendance"); if (!el) return;
    programmatic = true; el.value = Math.max(1, Math.round(v));
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    programmatic = false; applied = mode; renderDate(); render();
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify({ lineup: val("ltLineup"), budget: val("ltBudget") })); } catch (e) {} }
  function restore() { try { var s = JSON.parse(localStorage.getItem(LS) || "null"); if (s) { $("ltLineup").value = s.lineup || ""; $("ltBudget").value = s.budget || ""; } } catch (e) {} }

  // ---------- Date effects ----------
  function loadDates() {
    var start = val("startDate"); var box = $("ltDate"); if (!box) return;
    if (!start) { lastDates = null; box.innerHTML = '<p class="lt-muted">Set the start date to see weekday, holiday and going-out-night effects on turnout.</p>'; return; }
    var q = "?date=" + encodeURIComponent(start) + (val("endDate") ? "&end=" + encodeURIComponent(val("endDate")) : "") + "&country=" + country();
    fetch(BASE + "/api/date-effects" + q).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.schema) throw new Error((d && d.message) || "error"); lastDates = d; renderDate();
    }).catch(function (e) { box.innerHTML = '<p class="lt-muted">Date effects unavailable right now (' + esc(e.message) + ').</p>'; });
  }
  function renderDate() {
    var d = lastDates, box = $("ltDate"); if (!d || !box) return;
    var sig = d.days.map(function (day) {
      return '<div class="lt-sig"><b>' + esc(day.date) + " (" + esc(day.weekday) + ")</b>: ×" + day.net_multiplier + ' <span class="lt-muted">day ×' + day.day_multiplier + " · demand ×" + day.demand_boost + " · competition −" + Math.round(day.competition_penalty * 100) + "%</span>"
        + day.signals.filter(function (s) { return s.kind !== "weekday"; }).map(function (s) { return '<div class="lt-muted" title="' + esc(s.why) + '">• ' + esc(s.label) + " (" + esc(s.effect) + "): " + esc(s.why) + "</div>"; }).join("") + "</div>";
    }).join("");
    var canApply = applied !== "lineup";
    box.innerHTML = '<div class="banner info" style="margin:0.5rem 0"><b>Date effect ×' + d.net_multiplier + "</b>: " + esc(d.summary) + sig
      + '<div class="lt-muted" style="margin-top:0.3rem">' + esc(d.assumption) + "</div>"
      + (canApply ? '<button type="button" class="ghost" id="ltApplyDate" style="margin-top:0.4rem">' + (applied === "date" ? "Re-apply" : "Apply") + " ×" + d.net_multiplier + " to Attendance N" + (applied === "date" ? " (base " + n(baseN) + ")" : "") + "</button>" : '<div class="lt-muted">Already included in the lineup turnout applied to N.</div>') + "</div>";
    var b = $("ltApplyDate"); if (b) b.onclick = function () { if (applied !== "date") baseN = Number(val("attendance")) || 0; if (baseN) setN(baseN * d.net_multiplier, "date"); };
  }

  // ---------- Lineup draw + pay ----------
  function run(round) {
    var out = $("ltOut"), btn = $("ltRun");
    if (!val("ltLineup")) { out.innerHTML = '<p class="banner warn">Paste at least one artist.</p>'; return; }
    if (!cityStr()) { out.innerHTML = '<p class="banner warn">Set the city (and state) in the event profile first.</p>'; return; }
    save(); btn.disabled = true; btn.textContent = "Looking up artists…";
    var body = { lineup: val("ltLineup"), city: cityStr(), date: val("startDate") || null, end_date: val("endDate") || null, capacity: capacity(), genre: val("festGenre") || null, price: val("ticketPrice") || null, budget: val("ltBudget") || null, history: hist ? hist.rows() : [] };
    fetch(BASE + "/api/talent/draw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) throw new Error(j.message || "Something went wrong");
        if (j.incomplete) { out.innerHTML = '<p class="lt-muted">' + esc(j.message) + "</p>"; if ((round || 0) < 12) return run((round || 0) + 1); throw new Error("Lookups are slow right now; try again in a minute."); }
        last = j; render(); btn.disabled = false; btn.textContent = "Re-estimate lineup draw";
      }).catch(function (e) { out.innerHTML = '<p class="banner fail">' + esc(e.message) + "</p>"; btn.disabled = false; btn.textContent = "Estimate lineup draw"; });
  }
  function render() {
    var r = last, out = $("ltOut"); if (!r || !out) return;
    var t = r.lineup_total, p = r.pay;
    var rows = p.per_artist.map(function (a) {
      var art = r.artists.filter(function (x) { return x.name === a.name; })[0] || {};
      return '<tr class="lt-main"><td>#' + a.rank + " " + esc(a.name) + "</td><td>" + n(art.draw && art.draw.mid) + "</td><td><b>" + money(a.suggested_fee) + "</b></td><td>" + (a.market_low != null ? money(a.market_low) + "–" + money(a.market_high) : "–") + "</td></tr>"
        + '<tr class="lt-sub"><td colspan="4"><span class="lt-muted">' + Math.round(a.draw_share * 100) + "% of draw · confidence " + esc(art.confidence_label || "–") + (a.entered_fee != null ? " · your fee " + money(a.entered_fee) : "")
        + (a.past_fees && a.past_fees.length ? " · you paid " + a.past_fees.map(function (f) { return money(f.fee) + (f.date ? " (" + esc(f.date) + ")" : ""); }).join("; ") : "") + "</span>"
        + a.flags.map(function (f) { return '<span class="lt-flag">⚠ ' + esc(f) + "</span>"; }).join("") + "</td></tr>";
    }).join("");
    var N = Number(val("attendance")) || 0;
    out.innerHTML = '<div class="banner info" style="margin:0.5rem 0"><div class="lt-big">' + n(t.mid) + '</div><div>lineup-driven turnout (range ' + n(t.low) + "–" + n(t.high) + "), confidence " + esc(r.confidence.label)
      + ". Includes date effect ×" + (t.date_multiplier != null ? t.date_multiplier : 1) + " and price factor ×" + t.price_factor + (t.capped ? "; capped at " + n(t.cap) : "") + ".</div>"
      + '<button type="button" class="primary" id="ltApplyN" style="margin-top:0.4rem">Use ' + n(t.mid) + " as Attendance N" + (N ? " (now " + n(N) + ")" : "") + "</button>"
      + (applied === "lineup" ? ' <span class="lt-muted">Applied.</span>' : "") + "</div>"
      + '<ul class="lt-muted" style="padding-left:1rem;margin:0.25rem 0">' + r.feed.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>"
      + "<h3 style=\"margin:0.75rem 0 0.25rem;font-size:0.95rem\">Artist pay estimate</h3>"
      + (p.budget == null ? '<p class="lt-muted">Enter a total artist budget to split it by draw.</p>' : "")
      + '<div class="lt-wrap"><table class="lt-table"><tr><th>Artist</th><th>Draw</th><th>Suggested</th><th>Market range</th></tr>' + rows
      + "<tr><th>Total</th><th>" + n(t.mid) + "</th><th>" + money(p.totals.suggested) + "</th><th>" + (p.totals.market_low != null ? money(p.totals.market_low) + "–" + money(p.totals.market_high) : "–") + "</th></tr></table></div>"
      + (p.totals.entered != null ? '<p class="lt-muted">Your entered fees total ' + money(p.totals.entered) + ".</p>" : "")
      + (p.flags.length ? '<ul style="padding-left:1rem;margin:0.25rem 0">' + p.flags.map(function (f) { return '<li class="lt-flag">' + esc(f) + "</li>"; }).join("") + "</ul>" : "")
      + '<p class="lt-muted">' + (p.ticket_price ? "Ticket $" + p.ticket_price + " (" + esc(p.ticket_price_source) + "). " : "") + esc(p.method) + " A planning range, not a quote.</p>"
      + '<p class="lt-muted">' + esc(r.disclaimer) + ' Full detail per artist: <a href="' + BASE + '/talent" target="_blank" rel="noopener">Talent Draw Estimator</a>.</p>';
    $("ltApplyN").onclick = function () { setN(t.mid, "lineup"); };
  }

  function mount() {
    if (!$("lineupCard")) return;
    restore();
    $("ltRun").onclick = function () { run(0); };
    $("ltUseSimBudget").onclick = function () {
      var b = window.__ffLastBudget; var v = b && b.departments && b.departments.talent;
      if (v) { $("ltBudget").value = Math.round(v); save(); } else alert("Run the forecast first (Recalc) so the Talent / Lineup line exists.");
    };
    ["ltLineup", "ltBudget"].forEach(function (id) { $(id).addEventListener("change", save); });
    ["startDate", "endDate", "timezone"].forEach(function (id) { var el = $(id); if (el) el.addEventListener("change", function () { loadDates(); }); });
    var att = $("attendance"); if (att) att.addEventListener("input", function () { if (!programmatic) { applied = null; renderDate(); } });
    var s = document.createElement("script"); s.src = BASE + "/pj-history.js";
    s.onload = function () { if (window.PJHistory) hist = window.PJHistory.mount($("ltHist"), { onChange: function (r) { $("ltHistCount").textContent = r.length ? "(" + r.length + " rows)" : ""; } }); };
    s.onerror = function () { $("ltHist").innerHTML = '<p class="lt-muted">Historic data import is unavailable offline.</p>'; };
    document.head.appendChild(s);
    loadDates();
    var dk = ""; document.addEventListener("ff:recalc", function () { var k = val("startDate") + "|" + val("endDate") + "|" + country(); if (k !== dk) { dk = k; loadDates(); } });
    // keep the stepper below the (variable-height) sticky header
    var hdr = document.querySelector(".app-header");
    var setH = function () { if (hdr) document.documentElement.style.setProperty("--ff-header-h", hdr.offsetHeight + "px"); };
    setH(); window.addEventListener("resize", setH);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
  window.LineupTalent = { run: run, loadDates: loadDates };
})();
