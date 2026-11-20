/* Step 7 · Pack → "Download Event Bible" (v1.6). Fills templates/event_bible/event-bible.xlsx in the browser
 * from the current simulator state. Nothing is uploaded; weather comes from the Worker's /api/weather/risk. */
(function () {
  "use strict";
  var PJ = "https://events-patronjourney.message-0ad.workers.dev";
  function $(id) { return document.getElementById(id); }
  function status(msg, warn) { var s = $("ebStatus"); if (s) { s.textContent = msg; s.style.color = warn ? "#b3541e" : ""; } }
  function weatherFor(p, days) {
    var addr = [p.street, p.city, p.state, p.zip].filter(Boolean).join(", ");
    if (!addr || !p.start_date) return Promise.resolve(null);
    var sameOrigin = location.origin === PJ;
    if (!sameOrigin) return Promise.resolve(null); // the API has no CORS; standalone copies skip weather
    var url = "/api/weather/risk?address=" + encodeURIComponent(addr) + "&date=" + encodeURIComponent(p.start_date) + "&days=" + (days || 1);
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function collect() {
    if (typeof window.__ffReadForm !== "function") throw new Error("Simulator not ready yet.");
    var form = window.__ffReadForm();
    var budget = window.__ffLastBudget;
    if (!budget) throw new Error("Run the forecast first (Recalc) so the budget exists.");
    var days = (form.safetyWeather && form.safetyWeather.show_days) || 1;
    return weatherFor(form.profile || {}, days).then(function (w) {
      return EventBible.fromSimulator({
        form: form, budget: budget, model: window.BUDGET_MODEL, talent: window.__ffLastTalent || null,
        lineupText: $("ltLineup") ? $("ltLineup").value : "", talentBudget: $("ltBudget") ? Number($("ltBudget").value) || null : null,
        weather: w, mc: window.__ffLastMc || null, ros: window.__ffGetRos ? window.__ffGetRos() : [], origin: PJ,
        mode: "YOUR DATA — from Festival Forecaster",
      });
    });
  }
  function run() {
    var btn = $("btnEventBible");
    btn.disabled = true; status("Building your Event Bible…");
    Promise.resolve().then(collect).then(function (data) {
      EventBible.saveState(data); // lets /library fill any single template with the same data
      return EventBible.download("event-bible", data, { base: "templates/event_bible/" });
    }).then(function (r) {
      status("Downloaded " + r.name + " (" + Math.round(r.size / 1024) + " KB). Open it in Excel, Google Sheets or Numbers.");
    }).catch(function (e) { status(e.message || String(e), true); }).then(function () { btn.disabled = false; });
  }
  function init() {
    var btn = $("btnEventBible"); if (!btn || !window.EventBible) return;
    btn.addEventListener("click", run);
    var lib = $("btnLibrary");
    if (lib) lib.addEventListener("click", function () { try { collect().then(function (d) { EventBible.saveState(d); location.href = PJ + "/library/?mine=1"; }).catch(function () { location.href = PJ + "/library/"; }); } catch (e) { location.href = PJ + "/library/"; } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
