/**
 * Festival Forecaster v1.3 — Accuracy then UX (tiers, sponsors, AX stepper)
 * localStorage drafts only; baked JSON; no login.
 */
(function () {
  "use strict";

  const LS_KEY = "festival_forecaster_v1_draft";
  let model = null;
  let festivals = [];
  let lastPnL = null;
  let lastMC = null;
  let lastBudget = null;
  let lastLedgerRows = [];
  let rosGate = null;
  let mcPres = null;
  let currentAxStep = 1;
  let baselineMode = false; // Reset-to-sheet: empty wizard, no marketing slider
  let tierRows = []; // working tier table
  let sponsorRows = [];
  let boothRows = [];
  let sheetBaseline = null; // raw sheet KPIs at N0 for ledger

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function fmtMoney(n) {
    const v = Number(n) || 0;
    const sign = v < 0 ? "-" : "";
    return sign + "$" + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  function fmtMoney2(n) {
    const v = Number(n) || 0;
    const sign = v < 0 ? "-" : "";
    return (
      sign +
      "$" +
      Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  }
  function fmtNum(n, d) {
    return Number(n).toLocaleString("en-US", {
      maximumFractionDigits: d != null ? d : 2,
    });
  }

  function syncSheetTiersIfNeeded(N, ticket, camp_fee, p_camp) {
    const tiersOn = !!( $("#tiersEnabled") && $("#tiersEnabled").checked );
    if (!tiersOn || !model || typeof TicketTiers === "undefined") return;
    const allSheet =
      tierRows.length &&
      tierRows.every(function (t) {
        return t.source === "sheet";
      });
    if (!allSheet && tierRows.length) return;
    const defs = Object.assign({}, model.defaults, {
      ticket: ticket,
      camp_fee: camp_fee,
      p_camp: p_camp,
    });
    tierRows = TicketTiers.defaultTiersFromSheet(defs, N);
  }

  function readForm() {
    const marketingPct = Number($("#marketingPct").value);
    let N = Number($("#attendance").value) || (model && model.baseline.N0) || 0;
    const limitOn = !!( $("#limitRegEnabled") && $("#limitRegEnabled").checked );
    const limitVal = limitOn && $("#limitRegistrations") && $("#limitRegistrations").value
      ? Number($("#limitRegistrations").value)
      : 0;
    if (limitOn && limitVal > 0 && typeof TicketTiers !== "undefined") {
      N = TicketTiers.applyLimitRegistrations(N, limitVal);
    }

    const ticket = Number($("#ticketPrice").value);
    const camp_fee = Number($("#campFee").value);
    const p_camp = Number($("#pCamp").value) / 100;
    syncSheetTiersIfNeeded(N, ticket, camp_fee, p_camp);

    const wizard = baselineMode
      ? {}
      : {
          musicFocus: $("#musicFocus").checked ? "yes" : "no",
          experienceFocus: $("#experienceFocus").checked ? "yes" : false,
          camping: $("#campingOn").checked ? "on" : false,
          lastMinuteProduction: $("#lastMinute").checked,
          marketingPct: marketingPct,
          marketingHardCap: $("#marketingCap").value
            ? Number($("#marketingCap").value)
            : null,
        };

    const tiersOn = !!( $("#tiersEnabled") && $("#tiersEnabled").checked );
    let tiersPayload = { enabled: false, rows: tierRows.slice() };
    let ticketBuild = null;
    if (tiersOn && typeof TicketTiers !== "undefined") {
      const campSep = !!( $("#campSeparate") && $("#campSeparate").checked );
      const trev = TicketTiers.computeTierRevenue(tierRows, {
        enabled: true,
        N: N,
        camp_separate: campSep,
        camp_fee: camp_fee,
        p_camp: p_camp,
      });
      tiersPayload = {
        enabled: true,
        rows: trev.tiers,
        error: trev.error,
        revenue: trev.revenue,
        reconstruction_note: trev.reconstruction_note,
      };
      ticketBuild = trev.ticketBuild;
    }

    const sponsorsOn = !!( $("#sponsorsEnabled") && $("#sponsorsEnabled").checked );

    return {
      profile: {
        name: $("#festName").value.trim(),
        start_date: $("#startDate").value,
        end_date: $("#endDate").value,
        city: $("#city").value.trim(),
        state: $("#state").value.trim(),
        type: $("#festType").value.trim(),
        subtype: $("#festSubtype").value.trim(),
        camping: $("#campingOn").checked,
        N: N,
        timezone: $("#timezone") ? $("#timezone").value.trim() : "",
        venue: $("#venue") ? $("#venue").value.trim() : "",
        start_time: $("#startTime") ? $("#startTime").value : "",
        end_time: $("#endTime") ? $("#endTime").value : "",
        street: $("#venueStreet") ? $("#venueStreet").value.trim() : "",
        zip: $("#venueZip") ? $("#venueZip").value.trim() : "",
        genre: $("#festGenre") ? $("#festGenre").value.trim() : "",
        organizer: $("#organizer") ? $("#organizer").value.trim() : "",
        limit_registrations: limitOn && limitVal > 0 ? limitVal : null,
      },
      options: {
        N: N,
        ticket: ticket,
        camp_fee: camp_fee,
        p_camp: p_camp,
        scaleAncillaries: $("#scaleAncillaries").checked,
        wizard: wizard,
        ticketBuild: ticketBuild,
        limit_registrations: limitOn && limitVal > 0 ? limitVal : null,
        tiers: tiersPayload,
        sponsorsBooths: {
          enabled: sponsorsOn,
          sponsors: sponsorRows.slice(),
          booths: boothRows.slice(),
          site_cost: $("#sponsorSiteCost") ? Number($("#sponsorSiteCost").value) || 0 : 0,
        },
      },
      mcPreset: $("#mcPreset").value,
      rfid: {
        enabled: !!($("#rfidEnabled") && $("#rfidEnabled").checked),
        cashlessMode: $("#cashlessMode") ? $("#cashlessMode").value : "hybrid",
        qtyOverrides: readRfidQtyOverrides(),
      },
      safetyWeather: readSafetyWeatherForm(),
      baselineMode: baselineMode,
    };
  }

  function readRfidQtyOverrides() {
    // Only user-edited qtys (not every rendered default) so N changes refresh ASSUMPTION heuristics
    return Object.assign({}, window.__rfidQtyOverrides || {});
  }

  function setRfidQtyOverride(id, value) {
    if (!window.__rfidQtyOverrides) window.__rfidQtyOverrides = {};
    const v = Number(value);
    if (Number.isFinite(v) && v >= 0) window.__rfidQtyOverrides[id] = v;
  }

  function readSafetyWeatherQtyOverrides() {
    return Object.assign({}, window.__swQtyOverrides || {});
  }

  function setSafetyWeatherQtyOverride(id, value) {
    if (!window.__swQtyOverrides) window.__swQtyOverrides = {};
    const v = Number(value);
    if (Number.isFinite(v) && v >= 0) window.__swQtyOverrides[id] = v;
  }

  function readSafetyWeatherForm() {
    const peakRaw = $("#peakOccupancy") && $("#peakOccupancy").value;
    const N = Number($("#attendance") && $("#attendance").value) || 0;
    return {
      enabled: !!($("#safetyWeatherEnabled") && $("#safetyWeatherEnabled").checked),
      venue_mode: $("#venueMode") ? $("#venueMode").value : "outdoor",
      peak_occupancy: peakRaw !== "" && peakRaw != null ? Number(peakRaw) : N,
      show_days: $("#showDays") ? Number($("#showDays").value) : 3,
      load_in_days: $("#loadInDays") ? Number($("#loadInDays").value) : 2,
      camping: $("#campingOn") && $("#campingOn").checked,
      nearest_hospital_minutes: $("#nearestHospitalMin")
        ? Number($("#nearestHospitalMin").value)
        : 25,
      ahj_fire_permit_status: $("#ahjFirePermit")
        ? $("#ahjFirePermit").value
        : "unknown",
      lightning_stand_down_miles: $("#lightningMiles")
        ? Number($("#lightningMiles").value)
        : 8,
      wind_hold_mph: $("#windHoldMph") ? Number($("#windHoldMph").value) : 35,
      heat_index_cold_trigger: $("#heatColdNotes") ? $("#heatColdNotes").value : "",
      weather_service_budget: $("#weatherServiceBudget")
        ? Number($("#weatherServiceBudget").value)
        : 2500,
      cancellation_reserve_pct: $("#cancellationReservePct")
        ? Number($("#cancellationReservePct").value)
        : 5,
      qtyOverrides: readSafetyWeatherQtyOverrides(),
      state: $("#state") ? $("#state").value.trim() : "",
      city: $("#city") ? $("#city").value.trim() : "",
      start_date: $("#startDate") ? $("#startDate").value : "",
    };
  }

  function applyDefaultsToForm() {
    const d = model.defaults;
    const N0 = model.baseline.N0;
    $("#attendance").value = N0;
    $("#ticketPrice").value = d.ticket;
    $("#campFee").value = d.camp_fee;
    $("#pCamp").value = Math.round(d.p_camp * 100);
    $("#marketingPct").value = 16;
    $("#marketingPctLabel").textContent = "16%";
    $("#scaleAncillaries").checked = true;
    $("#musicFocus").checked = true;
    $("#campingOn").checked = true;
    $("#experienceFocus").checked = false;
    $("#lastMinute").checked = false;
    $("#festName").value = "Sample Music Festival";
    $("#festType").value = "Music";
    $("#festSubtype").value = "Camping";
    $("#city").value = "";
    $("#state").value = "";
    if ($("#rfidEnabled")) $("#rfidEnabled").checked = false;
    if ($("#cashlessMode")) $("#cashlessMode").value = "hybrid";
    if ($("#rfidQtyPanel")) $("#rfidQtyPanel").hidden = true;
    // ===== BEGIN Safety / Weather defaults =====
    if ($("#safetyWeatherEnabled")) $("#safetyWeatherEnabled").checked = false;
    if ($("#safetyWeatherPanel")) $("#safetyWeatherPanel").hidden = true;
    if ($("#venueMode")) $("#venueMode").value = "outdoor";
    if ($("#peakOccupancy")) $("#peakOccupancy").value = "";
    if ($("#showDays")) $("#showDays").value = 3;
    if ($("#loadInDays")) $("#loadInDays").value = 2;
    if ($("#nearestHospitalMin")) $("#nearestHospitalMin").value = 25;
    if ($("#ahjFirePermit")) $("#ahjFirePermit").value = "unknown";
    if ($("#lightningMiles")) $("#lightningMiles").value = 8;
    if ($("#windHoldMph")) $("#windHoldMph").value = 35;
    if ($("#weatherServiceBudget")) $("#weatherServiceBudget").value = 2500;
    if ($("#cancellationReservePct")) $("#cancellationReservePct").value = 5;
    if ($("#heatColdNotes")) $("#heatColdNotes").value = "";
    window.__swQtyOverrides = {};
    // ===== END Safety / Weather defaults =====
    if ($("#tiersEnabled")) $("#tiersEnabled").checked = false;
    if ($("#campSeparate")) $("#campSeparate").checked = false;
    if ($("#tiersPanel")) $("#tiersPanel").hidden = true;
    if ($("#limitRegEnabled")) $("#limitRegEnabled").checked = false;
    if ($("#limitRegWrap")) $("#limitRegWrap").hidden = true;
    if ($("#limitRegistrations")) $("#limitRegistrations").value = "";
    if ($("#sponsorsEnabled")) $("#sponsorsEnabled").checked = false;
    if ($("#sponsorsPanel")) $("#sponsorsPanel").hidden = true;
    if ($("#sponsorSiteCost")) $("#sponsorSiteCost").value = 0;
    if ($("#timezone")) $("#timezone").value = "America/Chicago";
    if ($("#venue")) $("#venue").value = "";
    if ($("#venueStreet")) $("#venueStreet").value = "";
    if ($("#venueZip")) $("#venueZip").value = "";
    if ($("#festGenre")) $("#festGenre").value = "";
    if ($("#startTime")) $("#startTime").value = "12:00";
    if ($("#endTime")) $("#endTime").value = "23:00";
    if ($("#organizer")) $("#organizer").value = "";
    sponsorRows = [];
    boothRows = [];
    baselineMode = false;
    if (model && typeof TicketTiers !== "undefined") {
      tierRows = TicketTiers.defaultTiersFromSheet(model.defaults, model.baseline.N0);
    } else {
      tierRows = [];
    }
  }

  function saveDraft() {
    const data = readForm();
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      flash("Draft saved locally.");
    } catch (e) {
      flash("Could not save draft: " + e.message, "warn");
    }
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) {
        flash("No draft found.", "info");
        return;
      }
      const data = JSON.parse(raw);
      const p = data.profile || {};
      const o = data.options || {};
      const w = o.wizard || {};
      if (p.name != null) $("#festName").value = p.name;
      if (p.start_date) $("#startDate").value = p.start_date;
      if (p.end_date) $("#endDate").value = p.end_date;
      if (p.city != null) $("#city").value = p.city;
      if (p.state != null) $("#state").value = p.state;
      if (p.type != null) $("#festType").value = p.type;
      if (p.timezone && $("#timezone")) $("#timezone").value = p.timezone;
      if (p.venue != null && $("#venue")) $("#venue").value = p.venue;
      if (p.street != null && $("#venueStreet")) $("#venueStreet").value = p.street;
      if (p.zip != null && $("#venueZip")) $("#venueZip").value = p.zip;
      if (p.genre != null && $("#festGenre")) $("#festGenre").value = p.genre;
      if (p.start_time && $("#startTime")) $("#startTime").value = p.start_time;
      if (p.end_time && $("#endTime")) $("#endTime").value = p.end_time;
      if (p.subtype != null) $("#festSubtype").value = p.subtype;
      if (o.N) $("#attendance").value = o.N;
      if (o.ticket) $("#ticketPrice").value = o.ticket;
      if (o.camp_fee != null) $("#campFee").value = o.camp_fee;
      if (o.p_camp != null) $("#pCamp").value = Math.round(o.p_camp * 100);
      if (typeof o.scaleAncillaries === "boolean")
        $("#scaleAncillaries").checked = o.scaleAncillaries;
      $("#musicFocus").checked = w.musicFocus === "yes" || w.musicFocus === true;
      $("#experienceFocus").checked = !!w.experienceFocus && w.experienceFocus !== false;
      $("#campingOn").checked = w.camping === "on" || w.camping === true || p.camping;
      $("#lastMinute").checked = !!w.lastMinuteProduction;
      if (w.marketingPct != null) {
        $("#marketingPct").value = w.marketingPct;
        $("#marketingPctLabel").textContent = w.marketingPct + "%";
      }
      if (w.marketingHardCap != null) $("#marketingCap").value = w.marketingHardCap;
      if (data.mcPreset) $("#mcPreset").value = data.mcPreset;
      if (data.rfid) {
        if ($("#rfidEnabled")) $("#rfidEnabled").checked = !!data.rfid.enabled;
        if ($("#cashlessMode") && data.rfid.cashlessMode)
          $("#cashlessMode").value = data.rfid.cashlessMode;
        window.__rfidQtyOverrides = data.rfid.qtyOverrides || {};
      }
      // ===== BEGIN Safety / Weather draft =====
      if (data.safetyWeather) {
        const sw = data.safetyWeather;
        if ($("#safetyWeatherEnabled")) $("#safetyWeatherEnabled").checked = !!sw.enabled;
        if ($("#venueMode") && sw.venue_mode) $("#venueMode").value = sw.venue_mode;
        if ($("#peakOccupancy") && sw.peak_occupancy != null)
          $("#peakOccupancy").value = sw.peak_occupancy;
        if ($("#showDays") && sw.show_days != null) $("#showDays").value = sw.show_days;
        if ($("#loadInDays") && sw.load_in_days != null)
          $("#loadInDays").value = sw.load_in_days;
        if ($("#nearestHospitalMin") && sw.nearest_hospital_minutes != null)
          $("#nearestHospitalMin").value = sw.nearest_hospital_minutes;
        if ($("#ahjFirePermit") && sw.ahj_fire_permit_status)
          $("#ahjFirePermit").value = sw.ahj_fire_permit_status;
        if ($("#lightningMiles") && sw.lightning_stand_down_miles != null)
          $("#lightningMiles").value = sw.lightning_stand_down_miles;
        if ($("#windHoldMph") && sw.wind_hold_mph != null)
          $("#windHoldMph").value = sw.wind_hold_mph;
        if ($("#weatherServiceBudget") && sw.weather_service_budget != null)
          $("#weatherServiceBudget").value = sw.weather_service_budget;
        if ($("#cancellationReservePct") && sw.cancellation_reserve_pct != null)
          $("#cancellationReservePct").value = sw.cancellation_reserve_pct;
        if ($("#heatColdNotes") && sw.heat_index_cold_trigger != null)
          $("#heatColdNotes").value = sw.heat_index_cold_trigger;
        window.__swQtyOverrides = sw.qtyOverrides || {};
      }
      // ===== END Safety / Weather draft =====
      flash("Draft loaded.", "info");
      recalculate();
    } catch (e) {
      flash("Draft load failed: " + e.message, "warn");
    }
  }

  function flash(msg, kind) {
    const el = $("#flash");
    el.className = "banner " + (kind || "info");
    el.textContent = msg;
    el.hidden = false;
  }

  function tip(cell, desc) {
    return (
      '<span class="tooltip-cell cell-ref" title="' +
      cell +
      (desc ? ": " + desc : "") +
      '">' +
      cell +
      "</span>"
    );
  }

  function renderPnL(r) {
    lastPnL = r;
    const setKpi = (id, val, money) => {
      const el = $(id);
      el.textContent = money ? fmtMoney(val) : fmtNum(val);
      el.classList.remove("pos", "neg");
      if (money) el.classList.add(val >= 0 ? "pos" : "neg");
    };
    setKpi("#kpiRevenue", r.K22, true);
    setKpi("#kpiOpex", r.G3_master != null ? r.G3_master : r.G3, true);
    setKpi("#kpiK24", r.K24, true);
    setKpi("#kpiK47", r.K47, true);

    const rows = [
      ["Site", r.departments.site, "C17"],
      ["Production (ex talent)", r.departments.production, "C49−C48"],
      ["Talent / Lineup", r.departments.talent, "C48"],
      ["Marketing", r.departments.marketing, "G34"],
      ["Ticketing", r.departments.ticketing, "C58"],
      ["Staff", r.departments.staff, "C75"],
      ["Annual ops", r.departments.annual_ops, "C81"],
      ["Pre-production", r.departments.pre_production, "G44"],
      ["Misc / guest exp", r.departments.misc, "G58"],
    ];

    let html = "<table class='pnl'><thead><tr><th>Bucket</th><th></th><th class='num'>Amount</th></tr></thead><tbody>";
    rows.forEach(([label, val, cell]) => {
      html +=
        "<tr><td>" +
        label +
        "</td><td class='cell' title='" +
        cell +
        "'>" +
        cell +
        "</td><td class='num'>" +
        fmtMoney2(val) +
        "</td></tr>";
    });
    html +=
      "<tr class='total'><td>Master Budget total opex</td><td class='cell'>G3</td><td class='num'>" +
      fmtMoney2(r.G3) +
      "</td></tr>";
    const hasRfid = r.rfid_enabled && r.rfid;
    const hasSw = r.safety_weather_enabled && r.safety_weather;
    if (hasRfid) {
      html +=
        "<tr class='addon-row'><td>RFID / Cashless (Basic Scenario) <span class='cell-ref' title='Optional add-on — not Master Budget'>add-on</span></td><td class='cell'>RFID</td><td class='num'>" +
        fmtMoney2(r.rfid_subtotal) +
        "</td></tr>";
    }
    // ===== BEGIN Safety / Weather P&L rows =====
    if (hasSw) {
      html +=
        "<tr class='addon-row'><td>Safety / Weather <span class='cell-ref' title='Optional add-on — not Master Budget; not a legal/safety plan'>add-on</span></td><td class='cell'>S/W</td><td class='num'>" +
        fmtMoney2(r.safety_weather_subtotal) +
        "</td></tr>";
    }
    // ===== END Safety / Weather P&L rows =====
    const hasSb = r.sponsors_booths_enabled && r.sponsors_booths;
    if (hasSb && r.sponsors_booths_site_cost > 0) {
      html +=
        "<tr class='addon-row'><td>Sponsors site cost <span class='cell-ref'>addon</span></td><td class='cell'>SB</td><td class='num'>" +
        fmtMoney2(r.sponsors_booths_site_cost) +
        "</td></tr>";
    }
    if (hasRfid || hasSw || (hasSb && r.sponsors_booths_site_cost > 0)) {
      const parts = ["G3"];
      if (hasRfid) parts.push("RFID");
      if (hasSw) parts.push("Safety/Weather");
      if (hasSb && r.sponsors_booths_site_cost > 0) parts.push("Sponsor site");
      html +=
        "<tr class='total addon-row'><td>Total opex (live = " +
        parts.join(" + ") +
        ")</td><td class='cell'>live</td><td class='num'>" +
        fmtMoney2(r.total_opex) +
        "</td></tr>";
      html +=
        "<tr class='sub'><td colspan='3' style='font-size:0.78rem'>Optional add-ons are additive to Master Budget for the live forecast only — not baked into G3." +
        (hasSw
          ? " Safety/Weather is a planning estimate only (not a legal/safety plan; not NOAA)."
          : "") +
        "</td></tr>";
    }
    html +=
      "<tr><td>Ticket + camp revenue</td><td class='cell'>K22</td><td class='num'>" +
      fmtMoney2(r.K22) +
      "</td></tr>";
    html +=
      "<tr><td>Break-even ticket</td><td class='cell'>K2</td><td class='num'>" +
      fmtMoney2(r.K2) +
      "</td></tr>";
    html +=
      "<tr><td>Profit pre-ancillary</td><td class='cell'>K24</td><td class='num'>" +
      fmtMoney2(r.K24) +
      "</td></tr>";
    html +=
      "<tr class='sub'><td>+ Kickback (K27)</td><td class='cell'>K27</td><td class='num'>" +
      fmtMoney2(r.kickback) +
      "</td></tr>";
    html +=
      "<tr class='sub'><td>+ Owner addback (K28)</td><td class='cell'>K28</td><td class='num'>" +
      fmtMoney2(r.owner) +
      "</td></tr>";
    html +=
      "<tr><td>After addbacks</td><td class='cell'>K30</td><td class='num'>" +
      fmtMoney2(r.K30) +
      "</td></tr>";
    html +=
      "<tr class='sub'><td>+ Ancillaries</td><td class='cell'>K33:K45</td><td class='num'>" +
      fmtMoney2(r.ancTotal) +
      "</td></tr>";
    if (hasSb && r.sponsors_booths_income > 0) {
      html +=
        "<tr class='sub addon-row'><td>+ Sponsors / booths income <span class='cell-ref'>addon</span></td><td class='cell'>SB</td><td class='num'>" +
        fmtMoney2(r.sponsors_booths_income) +
        "</td></tr>";
    }
    html +=
      "<tr class='total'><td>Full profit</td><td class='cell'>K47</td><td class='num'>" +
      fmtMoney2(r.K47) +
      "</td></tr>";
    html += "</tbody></table>";

    if (r.marketingPct != null) {
      html +=
        "<p class='banner info' style='margin-top:0.75rem'>Marketing slider " +
        r.marketingPct +
        "% → required spend " +
        fmtMoney2(r.marketingRequired) +
        (r.marketingHardCap != null
          ? " · hard cap " + fmtMoney2(r.marketingHardCap)
          : " · no hard cap") +
        ". Cap does not invent revenue.</p>";
      if (r.marketingNote) {
        html += "<p class='banner warn'>" + r.marketingNote + "</p>";
      }
    }

    if (r.warnings && r.warnings.length) {
      r.warnings.forEach((w) => {
        html += "<p class='banner warn'>" + w + "</p>";
      });
    }

    html += "<details class='anc'><summary>Ancillaries detail (" + r.ancillaries.length + ")</summary><table class='pnl'><tbody>";
    r.ancillaries.forEach((a) => {
      html +=
        "<tr><td>" +
        a.label +
        "</td><td class='cell'>" +
        a.cell +
        "</td><td class='num'>" +
        fmtMoney2(a.amount) +
        "</td></tr>";
    });
    html += "</tbody></table></details>";

    $("#pnlTable").innerHTML = html;

    // Profile N for poster/competitors
    const { profile } = readForm();
    profile.N = r.N;
  }


  function clearBaselineMode() {
    if (baselineMode) {
      baselineMode = false;
    }
  }

  function goAxStep(step) {
    step = Number(step) || 1;
    currentAxStep = step;
    $$(".ax-step").forEach(function (b) {
      b.classList.toggle("active", Number(b.dataset.step) === step);
    });
    $$(".ax-panel").forEach(function (p) {
      const ax = Number(p.dataset.ax);
      const show = ax === step;
      p.hidden = !show;
      p.classList.toggle("active", show);
    });
    $$(".ax-main-panel").forEach(function (p) {
      const keys = String(p.dataset.axMain || "").split(",").map(Number);
      const show = keys.indexOf(step) !== -1;
      p.hidden = !show;
    });
  }

  function ensureSheetBaseline() {
    if (!model || sheetBaseline) return;
    const rep = BudgetEngine.reconcileAtN0(model);
    sheetBaseline = {
      N: model.baseline.N0,
      K22: rep.result.K22,
      G3: rep.result.G3,
      K24: rep.result.K24,
      K47: rep.result.K47,
      cells: Object.assign({}, rep.result.cells),
    };
  }

  function resetToSheet() {
    if (!model) return;
    applyDefaultsToForm();
    baselineMode = true;
    // Raw sheet: no wizard multipliers, no marketing slider, ancillaries unscaled
    $("#musicFocus").checked = false;
    $("#experienceFocus").checked = false;
    $("#campingOn").checked = false;
    $("#lastMinute").checked = false;
    $("#scaleAncillaries").checked = false;
    if ($("#tiersEnabled")) $("#tiersEnabled").checked = false;
    if ($("#tiersPanel")) $("#tiersPanel").hidden = true;
    if ($("#sponsorsEnabled")) $("#sponsorsEnabled").checked = false;
    if ($("#sponsorsPanel")) $("#sponsorsPanel").hidden = true;
    if ($("#rfidEnabled")) $("#rfidEnabled").checked = false;
    if ($("#safetyWeatherEnabled")) $("#safetyWeatherEnabled").checked = false;
    if ($("#limitRegEnabled")) $("#limitRegEnabled").checked = false;
    if ($("#limitRegWrap")) $("#limitRegWrap").hidden = true;
    window.__rfidQtyOverrides = {};
    window.__swQtyOverrides = {};
    sponsorRows = [];
    boothRows = [];
    tierRows = TicketTiers.defaultTiersFromSheet(model.defaults, model.baseline.N0);
    if (rosGate && rosGate.isConfirmed()) {
      try { rosGate.edit(); } catch (e) {}
    }
    recalculate();
    flash("Reset to sheet N=" + model.baseline.N0 + " (raw KPIs; wizard/addons off).", "info");
  }

  function renderAssumptionLedger(r, form) {
    ensureSheetBaseline();
    const box = $("#assumptionLedger");
    if (!box || !sheetBaseline) return;
    const w = (form && form.options && form.options.wizard) || {};
    const rows = [];
    function add(label, active, detail, source) {
      rows.push({ label: label, active: !!active, detail: detail || "", source: source || "wizard" });
    }
    add("Music focus talent×1.5", w.musicFocus === "yes" || w.musicFocus === true, "off → ×0.5 when unchecked (not omit)", "wizard");
    add("Experience focus", w.experienceFocus === "yes" || w.experienceFocus === true, "prod×2, talent×0.25", "wizard");
    add("Camping ×1.10", w.camping === "on" || w.camping === true, "site + annual ops", "wizard");
    add("Last-minute ×1.20", !!w.lastMinuteProduction, "production", "wizard");
    add("Marketing % slider", w.marketingPct != null, (w.marketingPct != null ? w.marketingPct + "% ASSUMPTION / not G6:G33" : ""), "wizard");
    add("RFID add-on", form && form.rfid && form.rfid.enabled, r.rfid_subtotal ? fmtMoney2(r.rfid_subtotal) : "", "addon");
    add("Safety / Weather", form && form.safetyWeather && form.safetyWeather.enabled, r.safety_weather_subtotal ? fmtMoney2(r.safety_weather_subtotal) : "", "addon");
    add("Ticket tiers", form && form.options && form.options.tiers && form.options.tiers.enabled, form && form.options.tiers && form.options.tiers.reconstruction_note, "odoo-tier");
    add("Sponsors / Booths", r.sponsors_booths_enabled, r.sponsors_booths_income ? ("income " + fmtMoney2(r.sponsors_booths_income)) : "", "addon");
    add("Limit Registrations", !!(form && form.options && form.options.limit_registrations), form && form.options && form.options.limit_registrations ? ("cap " + form.options.limit_registrations) : "", "wizard");
    add("Baseline mode (sheet)", baselineMode, "empty wizard; marketing slider ignored", "sheet");

    lastLedgerRows = rows.slice();
    const dK22 = r.K22 - sheetBaseline.K22;
    const dG3 = (r.G3_master != null ? r.G3_master : r.G3) - sheetBaseline.G3;
    const dK24 = r.K24 - sheetBaseline.K24;
    const dK47 = r.K47 - sheetBaseline.K47;
    const liveDiff =
      Math.abs(dK22) > 1 || Math.abs(dG3) > 1 || Math.abs(dK24) > 1 || Math.abs(dK47) > 1 || !baselineMode;

    let html = "<table class='pnl ledger'><thead><tr><th>Assumption</th><th>On?</th><th>Detail</th><th>src</th></tr></thead><tbody>";
    rows.forEach(function (row) {
      html +=
        "<tr><td>" +
        escapeHtml(row.label) +
        "</td><td>" +
        (row.active ? "YES" : "—") +
        "</td><td style='font-size:0.75rem;color:var(--muted)'>" +
        escapeHtml(row.detail || "") +
        "</td><td class='cell'>" +
        escapeHtml(row.source) +
        "</td></tr>";
    });
    html += "</tbody></table>";
    html +=
      "<p class='footer-note' style='text-align:left;padding:0.35rem 0'>Δ vs raw sheet @ N0=" +
      sheetBaseline.N +
      ": K22 " +
      fmtMoney2(dK22) +
      " · G3 " +
      fmtMoney2(dG3) +
      " · K24 " +
      fmtMoney2(dK24) +
      " · K47 " +
      fmtMoney2(dK47) +
      " (live N=" +
      r.N +
      ")</p>";
    box.innerHTML = html;

    const ban = $("#liveDeltaBanner");
    if (ban) {
      // Show when live KPIs diverge from raw sheet path OR modifiers on
      const rawish =
        baselineMode &&
        Math.abs(r.N - sheetBaseline.N) < 0.5 &&
        Math.abs(r.K22 - sheetBaseline.K22) <= 1 &&
        Math.abs((r.G3_master != null ? r.G3_master : r.G3) - sheetBaseline.G3) <= 1 &&
        Math.abs(r.K47 - sheetBaseline.K47) <= 1;
      ban.hidden = !!rawish;
    }
  }

  function renderTiersPanel(r, form) {
    const enabled = $("#tiersEnabled") && $("#tiersEnabled").checked;
    const panel = $("#tiersPanel");
    if (!panel) return;
    panel.hidden = !enabled;
    if (!enabled) {
      if ($("#tiersError")) $("#tiersError").hidden = true;
      return;
    }
    if (!tierRows.length && model) {
      tierRows = TicketTiers.defaultTiersFromSheet(model.defaults, form.options.N);
    }
    const body = $("#tiersBody");
    let html = "";
    tierRows.forEach(function (t, i) {
      html +=
        "<tr><td><input type='text' data-ti='" +
        i +
        "' data-f='name' value='" +
        escapeHtml(t.name) +
        "' /></td>" +
        "<td class='num'><input type='number' step='0.01' data-ti='" +
        i +
        "' data-f='price' value='" +
        t.price +
        "' /></td>" +
        "<td class='num'><input type='number' step='1' data-ti='" +
        i +
        "' data-f='max' value='" +
        (t.max != null ? t.max : "") +
        "' /></td>" +
        "<td><input type='date' data-ti='" +
        i +
        "' data-f='sales_start' value='" +
        escapeHtml(t.sales_start || "") +
        "' /></td>" +
        "<td><input type='date' data-ti='" +
        i +
        "' data-f='sales_end' value='" +
        escapeHtml(t.sales_end || "") +
        "' /></td>" +
        "<td class='num'><input type='number' step='1' data-ti='" +
        i +
        "' data-f='expected_qty' value='" +
        t.expected_qty +
        "' /></td></tr>";
    });
    body.innerHTML = html;
    body.querySelectorAll("input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        clearBaselineMode();
        const i = Number(inp.dataset.ti);
        const f = inp.dataset.f;
        let v = inp.value;
        if (f === "price" || f === "max" || f === "expected_qty") {
          v = v === "" ? (f === "max" ? null : 0) : Number(v);
        }
        tierRows[i][f] = v;
        if (f !== "name" && f !== "sales_start" && f !== "sales_end") {
          tierRows[i].source = "odoo-tier";
        }
        recalculate();
      });
    });
    const trev =
      form && form.options && form.options.tiers
        ? form.options.tiers
        : TicketTiers.computeTierRevenue(tierRows, {
            enabled: true,
            N: form.options.N,
            camp_separate: $("#campSeparate") && $("#campSeparate").checked,
            camp_fee: form.options.camp_fee,
            p_camp: form.options.p_camp,
          });
    if ($("#tiersLiveK22")) {
      $("#tiersLiveK22").textContent =
        "Live K22 (tiers): " +
        fmtMoney2(r.K22) +
        " · " +
        (trev.reconstruction_note || "");
    }
    if ($("#tiersError")) {
      if (trev.error) {
        $("#tiersError").hidden = false;
        $("#tiersError").textContent = trev.error;
      } else {
        $("#tiersError").hidden = true;
      }
    }
  }

  function renderSponsorsPanel(r) {
    const enabled = $("#sponsorsEnabled") && $("#sponsorsEnabled").checked;
    const panel = $("#sponsorsPanel");
    if (!panel) return;
    panel.hidden = !enabled;
    if (!enabled) return;
    const sBox = $("#sponsorsList");
    let sh = "";
    sponsorRows.forEach(function (s, i) {
      sh +=
        "<div class='grid-2' style='margin-bottom:0.35rem'>" +
        "<input type='text' placeholder='Name' data-si='" +
        i +
        "' data-f='name' value='" +
        escapeHtml(s.name || "") +
        "' />" +
        "<input type='text' placeholder='Level' data-si='" +
        i +
        "' data-f='level' value='" +
        escapeHtml(s.level || "") +
        "' />" +
        "<input type='number' placeholder='Count' data-si='" +
        i +
        "' data-f='count' value='" +
        (s.count != null ? s.count : 1) +
        "' />" +
        "<input type='number' placeholder='Fee $' data-si='" +
        i +
        "' data-f='fee' value='" +
        (s.fee != null ? s.fee : 0) +
        "' />" +
        "</div>";
    });
    sBox.innerHTML = sh || "<p class='footer-note' style='text-align:left'>No sponsors yet.</p>";
    const bBox = $("#boothsList");
    let bh = "";
    boothRows.forEach(function (b, i) {
      bh +=
        "<div class='grid-2' style='margin-bottom:0.35rem'>" +
        "<input type='text' placeholder='Category' data-bi='" +
        i +
        "' data-f='category' value='" +
        escapeHtml(b.category || "") +
        "' />" +
        "<input type='number' placeholder='Count' data-bi='" +
        i +
        "' data-f='count' value='" +
        (b.count != null ? b.count : 1) +
        "' />" +
        "<input type='number' placeholder='Price $' data-bi='" +
        i +
        "' data-f='price' value='" +
        (b.price != null ? b.price : 0) +
        "' />" +
        "</div>";
    });
    bBox.innerHTML = bh || "<p class='footer-note' style='text-align:left'>No booths yet.</p>";
    sBox.querySelectorAll("input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        clearBaselineMode();
        const i = Number(inp.dataset.si);
        const f = inp.dataset.f;
        let v = inp.value;
        if (f === "count" || f === "fee") v = Number(v) || 0;
        sponsorRows[i][f] = v;
        recalculate();
      });
    });
    bBox.querySelectorAll("input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        clearBaselineMode();
        const i = Number(inp.dataset.bi);
        const f = inp.dataset.f;
        let v = inp.value;
        if (f === "count" || f === "price") v = Number(v) || 0;
        boothRows[i][f] = v;
        recalculate();
      });
    });
    if ($("#sponsorsSummary") && r.sponsors_booths) {
      $("#sponsorsSummary").textContent =
        "Income " +
        fmtMoney2(r.sponsors_booths_income || 0) +
        " · site cost " +
        fmtMoney2(r.sponsors_booths_site_cost || 0) +
        " (outside G3)";
    }
  }

  function odooExportOpts(form) {
    return {
      tiers: form.options.tiers && form.options.tiers.rows,
      sponsors: sponsorRows,
      booths: boothRows,
      limit_registrations: form.profile.limit_registrations,
      timezone: form.profile.timezone,
      venue: form.profile.venue,
      organizer: form.profile.organizer,
      visibility: "public",
      tags: [form.profile.type, form.profile.subtype].filter(Boolean).join("|"),
    };
  }

  function recalculate() {
    if (!model) return;
    const form = readForm();
    const options = form.options;
    const profile = form.profile;
    options.rfid = form.rfid;
    // Merge draft overrides if qty inputs not yet rendered
    if (
      form.rfid.enabled &&
      Object.keys(form.rfid.qtyOverrides || {}).length === 0 &&
      window.__rfidQtyOverrides
    ) {
      options.rfid.qtyOverrides = window.__rfidQtyOverrides;
    }
    // ===== BEGIN Safety / Weather compute wiring =====
    options.safetyWeather = form.safetyWeather;
    options.profile = profile;
    options.state = profile.state;
    options.city = profile.city;
    options.start_date = profile.start_date;
    if (
      form.safetyWeather.enabled &&
      Object.keys(form.safetyWeather.qtyOverrides || {}).length === 0 &&
      window.__swQtyOverrides
    ) {
      options.safetyWeather.qtyOverrides = window.__swQtyOverrides;
    }
    // ===== END Safety / Weather compute wiring =====
    options.sponsorsBooths = form.options.sponsorsBooths;
    options.ticketBuild = form.options.ticketBuild;
    options.limit_registrations = form.options.limit_registrations;
    options.tiers = form.options.tiers;
    const r = BudgetEngine.compute(model, options);
    lastBudget = r;
    renderRfidPanel(r);
    renderSafetyWeatherPanel(r);
    renderTiersPanel(r, form);
    renderSponsorsPanel(r);
    renderPnL(r);
    renderAssumptionLedger(r, form);
    renderCompetitors(profile, r);
    if (typeof updateCreateButtons === "function") updateCreateButtons();
  }

  function renderRfidPanel(r) {
    const enabled = $("#rfidEnabled") && $("#rfidEnabled").checked;
    const panel = $("#rfidQtyPanel");
    if (!panel) return;
    panel.hidden = !enabled;
    if (!enabled) {
      $("#rfidSubtotal").textContent = fmtMoney2(0);
      return;
    }
    // Prefer engine result; else compute locally for table
    let est = r && r.rfid;
    if (!est || !est.enabled) {
      const N = Number($("#attendance").value) || (model && model.baseline.N0) || 0;
      const overrides = Object.assign(
        {},
        window.__rfidQtyOverrides || {},
        readRfidQtyOverrides()
      );
      est = RfidAddon.computeRfidEstimate({ N: N, enabled: true, qtyOverrides: overrides });
    }
    const body = $("#rfidQtyBody");
    const prevFocus = document.activeElement && document.activeElement.classList.contains("rfid-qty-input")
      ? document.activeElement.dataset.id
      : null;
    const prevSel =
      document.activeElement && document.activeElement.classList.contains("rfid-qty-input")
        ? [document.activeElement.selectionStart, document.activeElement.selectionEnd]
        : null;

    let html = "";
    (est.lines || []).forEach(function (line) {
      html +=
        "<tr class='rfid-row'><td>" +
        escapeHtml(line.label) +
        "<div class='muted-label'>" +
        escapeHtml(line.unit || "") +
        (line.sheet ? " · " + escapeHtml(line.sheet) : "") +
        "</div></td><td class='num'>" +
        fmtMoney2(line.unit_price) +
        "</td><td class='num'><input type='number' min='0' step='1' class='rfid-qty-input' data-id='" +
        escapeHtml(line.id) +
        "' value='" +
        line.qty +
        "' /></td><td class='num'>" +
        fmtMoney2(line.extended) +
        "</td></tr>";
    });
    body.innerHTML = html;
    $("#rfidSubtotal").textContent = fmtMoney2(est.subtotal);
    if ($("#rfidAssumption")) {
      $("#rfidAssumption").textContent =
        est.assumption_note ||
        "ASSUMPTION: default qtys from heuristics. Edit any qty.";
    }
    if ($("#rfidPassthrough") && est.consumer_passthrough) {
      const cp = est.consumer_passthrough;
      $("#rfidPassthrough").textContent =
        "Consumer pass-through (NOT promoter opex): ticket fee $" +
        Number(cp.ticket_fee_consumer).toFixed(2) +
        " · fulfill fee $" +
        Number(cp.fulfill_fee_consumer).toFixed(2);
    }
    // Re-bind qty inputs
    $$(".rfid-qty-input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        setRfidQtyOverride(inp.dataset.id, inp.value);
        recalculate();
      });
    });
    if (prevFocus) {
      const el = document.querySelector('.rfid-qty-input[data-id="' + prevFocus + '"]');
      if (el) {
        el.focus();
        if (prevSel) {
          try {
            el.setSelectionRange(prevSel[0], prevSel[1]);
          } catch (e) {}
        }
      }
    }
  }

  // ===== BEGIN Safety / Weather panel =====
  function renderSafetyWeatherPanel(r) {
    const enabled = $("#safetyWeatherEnabled") && $("#safetyWeatherEnabled").checked;
    const panel = $("#safetyWeatherPanel");
    if (!panel) return;
    panel.hidden = !enabled;
    if (!enabled) {
      if ($("#safetyWeatherSubtotal")) $("#safetyWeatherSubtotal").textContent = fmtMoney2(0);
      return;
    }
    let est = r && r.safety_weather;
    if (!est || !est.enabled) {
      const form = readSafetyWeatherForm();
      const N = Number($("#attendance").value) || (model && model.baseline.N0) || 0;
      // Need master G3 for cancellation reserve — compute base without SW if needed
      const baseOnly = BudgetEngine.compute(model, {
        N: N,
        ticket: Number($("#ticketPrice").value),
        camp_fee: Number($("#campFee").value),
        p_camp: Number($("#pCamp").value) / 100,
        scaleAncillaries: $("#scaleAncillaries").checked,
        wizard: {
          musicFocus: $("#musicFocus").checked ? "yes" : "no",
          experienceFocus: $("#experienceFocus").checked ? "yes" : false,
          camping: $("#campingOn").checked ? "on" : false,
          lastMinuteProduction: $("#lastMinute").checked,
          marketingPct: Number($("#marketingPct").value),
          marketingHardCap: $("#marketingCap").value
            ? Number($("#marketingCap").value)
            : null,
        },
        rfid: { enabled: false },
        safetyWeather: { enabled: false },
      });
      est = SafetyWeather.computeSafetyWeatherEstimate(
        Object.assign({}, form, {
          enabled: true,
          N: N,
          master_opex: baseOnly.G3,
          qtyOverrides: Object.assign({}, window.__swQtyOverrides || {}, form.qtyOverrides),
        })
      );
    }
    const body = $("#safetyWeatherQtyBody");
    const prevFocus =
      document.activeElement && document.activeElement.classList.contains("sw-qty-input")
        ? document.activeElement.dataset.id
        : null;
    let html = "";
    (est.lines || []).forEach(function (line) {
      html +=
        "<tr class='rfid-row'><td>" +
        escapeHtml(line.label) +
        "<div class='muted-label'>" +
        escapeHtml(line.unit || "") +
        (line.category ? " · " + escapeHtml(line.category) : "") +
        "</div></td><td class='num'>" +
        fmtMoney2(line.unit_price) +
        "</td><td class='num'><input type='number' min='0' step='1' class='sw-qty-input' data-id='" +
        escapeHtml(line.id) +
        "' value='" +
        line.qty +
        "' /></td><td class='num'>" +
        fmtMoney2(line.extended) +
        "</td></tr>";
    });
    body.innerHTML = html;
    $("#safetyWeatherSubtotal").textContent = fmtMoney2(est.subtotal);
    if ($("#safetyWeatherAssumption")) {
      $("#safetyWeatherAssumption").textContent =
        est.assumption_note ||
        "ASSUMPTION: default qtys from heuristics. Edit any qty.";
    }
    if ($("#safetyWeatherDisclaimer")) {
      $("#safetyWeatherDisclaimer").textContent =
        est.disclaimer ||
        "Planning estimate only — not a legal/safety plan.";
    }
    $$(".sw-qty-input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        setSafetyWeatherQtyOverride(inp.dataset.id, inp.value);
        recalculate();
      });
    });
    if (prevFocus) {
      const el = document.querySelector('.sw-qty-input[data-id="' + prevFocus + '"]');
      if (el) el.focus();
    }
  }
  // ===== END Safety / Weather panel =====

  function renderCompetitors(profile, r) {
    const self = {
      ...profile,
      N: r.N,
      attendance: r.N,
      category: profile.type || profile.category,
      subcategory: profile.subtype || profile.subcategory,
      start: profile.start_date || profile.start,
      end: profile.end_date || profile.end,
    };
    const out = Competitors.match(self, festivals);
    const box = $("#competitorList");
    if (out.empty) {
      box.innerHTML =
        "<div class='banner info'>" +
        out.message +
        "</div><p class='footer-note'>Top 0 — competitor UI idle until festivals.json is populated. Never invents festivals.</p>";
      return;
    }
    if (!out.matches.length) {
      box.innerHTML = "<div class='banner warn'>" + out.message + "</div>";
      return;
    }
    box.innerHTML =
      "<p class='banner info'>" +
      out.message +
      "</p>" +
      out.matches
        .map((m) => {
          const f = m.festival;
          const title = f.name || f.title || "Unnamed";
          const where = [f.city, f.state].filter(Boolean).join(", ");
          return (
            "<div class='competitor'><div class='title'><span>" +
            escapeHtml(title) +
            (where ? " · " + escapeHtml(where) : "") +
            "</span><span>score " +
            m.score +
            (m.stale ? " <span class='badge'>month-day; listing year may be stale</span>" : "") +
            "</span></div><div class='reasons'>" +
            escapeHtml(m.reasons.join(" · ") || "—") +
            "</div></div>"
          );
        })
        .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function runReconcile() {
    const report = BudgetEngine.reconcileAtN0(model);
    const box = $("#reconcileBox");
    let html =
      "<div class='banner " +
      (report.pass ? "pass" : "fail") +
      "'>Reconcile at N=" +
      report.N +
      ": " +
      (report.pass ? "PASS" : "FAIL") +
      " (tolerance $1)</div>";
    html += "<table class='pnl'><thead><tr><th>Cell</th><th class='num'>Sheet</th><th class='num'>Model</th><th class='num'>Δ</th><th></th></tr></thead><tbody>";
    report.dollar.forEach((row) => {
      html +=
        "<tr><td>" +
        row.label +
        "</td><td class='num'>" +
        fmtMoney2(row.sheet) +
        "</td><td class='num'>" +
        fmtMoney2(row.model) +
        "</td><td class='num'>" +
        fmtMoney2(row.delta) +
        "</td><td>" +
        (row.pass ? "PASS" : "FAIL") +
        "</td></tr>";
    });
    html += "</tbody></table>";
    box.innerHTML = html;
    goAxStep(6);
  }

  function renderMcNumbers(result) {
    $("#mcSentence").textContent = result.sentence;
    $("#mcP10").textContent = fmtMoney(result.P10);
    $("#mcP50").textContent = fmtMoney(result.P50);
    $("#mcP90").textContent = fmtMoney(result.P90);
    $("#mcPProfit").textContent = Math.round(result.pProfit * 100) + "%";
    $("#mcPCover").textContent = Math.round(result.pCover * 100) + "%";

    const maxSwing = Math.max(...result.tornado.map((t) => t.swing), 1);
    $("#tornado").innerHTML = result.tornado
      .map((t) => {
        const pct = (t.swing / maxSwing) * 100;
        return (
          "<div class='row'><div>" +
          escapeHtml(t.name) +
          "</div><div class='bar-wrap'><div class='bar' style='left:0;width:" +
          pct +
          "%' title='low " +
          fmtMoney(t.low) +
          " · high " +
          fmtMoney(t.high) +
          "'></div></div></div>"
        );
      })
      .join("");
  }

  function startJourneyPresentation(result, band) {
    if (!mcPres || !rosGate || !rosGate.isConfirmed()) return;
    const form = readForm();
    const healthOn = !!( $("#healthProtocolOn") && $("#healthProtocolOn").checked);
    const headliner =
      (form.profile && form.profile.talent_names && form.profile.talent_names[0]) ||
      "the headliner";
    mcPres.start({
      mcResult: result,
      band: band || "P50",
      campingOn: !!$("#campingOn").checked,
      healthProtocolOn: healthOn,
      ros: rosGate.getConfirmedRos(),
      durationMs: 30000,
      seed: 42,
      ctx: {
        event: form.profile.name || "the fest",
        city: form.profile.city || "town",
        headliner: headliner,
        day: 1,
      },
    });
  }

  function runMonteCarlo() {
    if (!rosGate || !rosGate.isConfirmed()) {
      flash("Confirm ROS before running Monte Carlo.", "warn");
      $("#mcStatus").textContent = "ROS not confirmed — Run stays disabled.";
      if ($("#btnMC")) $("#btnMC").disabled = true;
      return;
    }
    const form = readForm();
    if (form.options.tiers && form.options.tiers.enabled && form.options.tiers.error) {
      flash(form.options.tiers.error, "warn");
      $("#mcStatus").textContent = "Tier qty sum ≠ N — fix tiers before MC.";
      return;
    }
    const options = form.options;
    options.rfid = form.rfid;
    options.safetyWeather = form.safetyWeather;
    options.sponsorsBooths = form.options.sponsorsBooths;
    options.ticketBuild = form.options.ticketBuild;
    options.limit_registrations = form.options.limit_registrations;
    options.tiers = form.options.tiers;
    options.profile = form.profile;
    options.state = form.profile.state;
    options.city = form.profile.city;
    options.start_date = form.profile.start_date;
    const preset = $("#mcPreset").value;
    $("#mcStatus").textContent = "Running 5,000 draws…";
    // Yield to UI
    setTimeout(() => {
      const result = MonteCarlo.run(model, options, { draws: 5000, preset: preset, seed: 42 });
      lastMC = result;
      updateCreateButtons();
      $("#mcStatus").textContent = "Numbers ready — animating P50 journey draw…";
      // STEP D: numbers FIRST (visible without watching animation)
      renderMcNumbers(result);
      goAxStep(5);
      // STEP B/C: animate one representative draw (default P50)
      startJourneyPresentation(result, "P50");
    }, 30);
  }

  function showPanel(id) {
    $$(".panel-stack").forEach((p) => p.classList.remove("active"));
    $$(".tabs button").forEach((b) => b.classList.remove("active"));
    const panel = $("#panel-" + id);
    if (panel) panel.classList.add("active");
    const btn = document.querySelector('.tabs button[data-panel="' + id + '"]');
    if (btn) btn.classList.add("active");
  }

  function wire() {
    $$(".ax-step").forEach(function (b) {
      b.addEventListener("click", function () {
        goAxStep(b.dataset.step);
      });
    });
    $$("[data-goto]").forEach(function (b) {
      b.addEventListener("click", function () {
        goAxStep(b.dataset.goto);
      });
    });
    if ($("#btnResetSheet")) $("#btnResetSheet").addEventListener("click", resetToSheet);
    if ($("#btnResetSheet2")) $("#btnResetSheet2").addEventListener("click", resetToSheet);

    if ($("#limitRegEnabled")) {
      $("#limitRegEnabled").addEventListener("change", function () {
        clearBaselineMode();
        if ($("#limitRegWrap")) $("#limitRegWrap").hidden = !$("#limitRegEnabled").checked;
        recalculate();
      });
    }
    if ($("#limitRegistrations")) {
      $("#limitRegistrations").addEventListener("change", function () {
        clearBaselineMode();
        recalculate();
      });
    }

    if ($("#tiersEnabled")) {
      $("#tiersEnabled").addEventListener("change", function () {
        clearBaselineMode();
        if ($("#tiersEnabled").checked && (!tierRows.length) && model) {
          tierRows = TicketTiers.defaultTiersFromSheet(
            model.defaults,
            Number($("#attendance").value) || model.baseline.N0
          );
        }
        recalculate();
      });
    }
    if ($("#campSeparate")) {
      $("#campSeparate").addEventListener("change", function () {
        clearBaselineMode();
        recalculate();
      });
    }
    if ($("#btnAddTier")) {
      $("#btnAddTier").addEventListener("click", function () {
        clearBaselineMode();
        tierRows.push({
          id: "tier_" + Date.now(),
          name: "VIP",
          price: 399,
          max: 100,
          sales_start: "",
          sales_end: "",
          expected_qty: 0,
          source: "odoo-tier",
        });
        if ($("#tiersEnabled")) $("#tiersEnabled").checked = true;
        recalculate();
      });
    }
    if ($("#btnResetTiers")) {
      $("#btnResetTiers").addEventListener("click", function () {
        clearBaselineMode();
        const N = Number($("#attendance").value) || model.baseline.N0;
        // Rebuild defaults using current K7/K6/K8 from form
        const defs = Object.assign({}, model.defaults, {
          ticket: Number($("#ticketPrice").value),
          camp_fee: Number($("#campFee").value),
          p_camp: Number($("#pCamp").value) / 100,
        });
        tierRows = TicketTiers.defaultTiersFromSheet(defs, N);
        recalculate();
      });
    }

    if ($("#sponsorsEnabled")) {
      $("#sponsorsEnabled").addEventListener("change", function () {
        clearBaselineMode();
        recalculate();
      });
    }
    if ($("#btnAddSponsor")) {
      $("#btnAddSponsor").addEventListener("click", function () {
        clearBaselineMode();
        sponsorRows.push({
          name: "Sponsor",
          level: "Gold",
          type: "cash",
          count: 1,
          fee: 5000,
          show_on_ticket: true,
        });
        if ($("#sponsorsEnabled")) $("#sponsorsEnabled").checked = true;
        recalculate();
      });
    }
    if ($("#btnAddBooth")) {
      $("#btnAddBooth").addEventListener("click", function () {
        clearBaselineMode();
        boothRows.push({ category: "Craft", count: 10, price: 250, creates_sponsor: false });
        if ($("#sponsorsEnabled")) $("#sponsorsEnabled").checked = true;
        recalculate();
      });
    }
    if ($("#sponsorSiteCost")) {
      $("#sponsorSiteCost").addEventListener("change", function () {
        clearBaselineMode();
        recalculate();
      });
    }

    $("#marketingPct").addEventListener("input", (e) => {
      $("#marketingPctLabel").textContent = e.target.value + "%";
      clearBaselineMode();
    });

    [
      "attendance",
      "ticketPrice",
      "campFee",
      "pCamp",
      "marketingPct",
      "marketingCap",
      "musicFocus",
      "experienceFocus",
      "campingOn",
      "lastMinute",
      "scaleAncillaries",
      "festName",
      "festType",
      "festSubtype",
      "city",
      "state",
      "startDate",
      "endDate",
    ].forEach((id) => {
      const el = $("#" + id);
      if (el)
        el.addEventListener("change", function () {
          clearBaselineMode();
          recalculate();
        });
      if (el && (el.type === "number" || el.type === "range"))
        el.addEventListener("input", () => {
          if (id === "marketingPct") return;
          clearBaselineMode();
          recalculate();
        });
    });
    $("#marketingPct").addEventListener("change", function () {
      clearBaselineMode();
      recalculate();
    });

    if ($("#campingOn")) {
      $("#campingOn").addEventListener("change", function () {
        if (rosGate && rosGate.isConfirmed()) {
          // Camping flag affects camp_open requirement — force re-confirm
          rosGate.edit();
          flash("Camping changed — re-confirm ROS before Monte Carlo.", "warn");
        }
      });
    }
    if ($("#rfidEnabled")) {
      $("#rfidEnabled").addEventListener("change", function () {
        clearBaselineMode();
        if (!$("#rfidEnabled").checked) {
          window.__rfidQtyOverrides = {};
        }
        recalculate();
      });
    }
    if ($("#cashlessMode")) {
      $("#cashlessMode").addEventListener("change", recalculate);
    }

    // ===== BEGIN Safety / Weather listeners =====
    if ($("#safetyWeatherEnabled")) {
      $("#safetyWeatherEnabled").addEventListener("change", function () {
        clearBaselineMode();
        if (!$("#safetyWeatherEnabled").checked) {
          window.__swQtyOverrides = {};
        }
        recalculate();
      });
    }
    [
      "venueMode",
      "peakOccupancy",
      "showDays",
      "loadInDays",
      "nearestHospitalMin",
      "ahjFirePermit",
      "lightningMiles",
      "windHoldMph",
      "weatherServiceBudget",
      "cancellationReservePct",
      "heatColdNotes",
    ].forEach(function (id) {
      const el = $("#" + id);
      if (el) el.addEventListener("change", recalculate);
      if (el && el.type === "number") el.addEventListener("input", recalculate);
    });
    // ===== END Safety / Weather listeners =====

    $("#btnRecalc").addEventListener("click", recalculate);
    $("#btnReconcile").addEventListener("click", runReconcile);
    $("#btnMC").addEventListener("click", runMonteCarlo);
    // Phase 2 ROS gate — Run disabled until Confirm
    if ($("#btnMC")) $("#btnMC").disabled = true;
    rosGate = RosGate.createController({
      panelId: "rosGatePanel",
      tableBodyId: "rosTableBody",
      errorId: "rosGateErrors",
      badgeId: "rosConfirmedBadge",
      getCamping: function () { return !!($("#campingOn") && $("#campingOn").checked); },
      getProfile: function () {
        const form = readForm();
        const p = Object.assign({}, form.profile);
        p.show_days = $("#showDays") ? Number($("#showDays").value) || undefined : undefined;
        p.cashlessMode = $("#cashlessMode") ? $("#cashlessMode").value : "hybrid";
        p.camping = !!($("#campingOn") && $("#campingOn").checked);
        return p;
      },
      setRunEnabled: function (on) {
        if ($("#btnMC")) {
          $("#btnMC").disabled = !on;
          $("#btnMC").title = on ? "Run 5,000 Monte Carlo draws" : "Confirm ROS first";
        }
      },
      onStatus: function (msg, kind) { flash(msg, kind === "pass" ? "info" : kind); },
    });
    if ($("#btnRosUseMine")) $("#btnRosUseMine").addEventListener("click", function () { rosGate.startEditEmpty(); });
    if ($("#btnRosSkeleton")) $("#btnRosSkeleton").addEventListener("click", function () { rosGate.startSkeleton(); });
    if ($("#btnRosConfirm")) $("#btnRosConfirm").addEventListener("click", function () { rosGate.confirm(); });
    if ($("#btnRosEdit")) $("#btnRosEdit").addEventListener("click", function () { rosGate.edit(); });
    if ($("#btnRosCancel")) $("#btnRosCancel").addEventListener("click", function () { rosGate.cancel(); });

    mcPres = McPresentation.create({
      onComplete: function () {
        $("#mcStatus").textContent = "Journey complete — numbers above; optional replay below.";
      },
      onDownloadPack: function () {
        if ($("#btnTemplates")) $("#btnTemplates").click();
      },
    });
    mcPres.wireControls();
    $("#btnSave").addEventListener("click", saveDraft);
    $("#btnLoad").addEventListener("click", loadDraft);
    $("#btnPoster").addEventListener("click", () => {
      const { profile } = readForm();
      if (lastPnL) profile.N = lastPnL.N;
      Poster.download(profile, lastPnL);
    });
    $("#btnTemplates").addEventListener("click", () => {
      const form = readForm();
      const profile = Object.assign({}, form.profile, {
        camping: !!$("#campingOn").checked,
        N: form.options.N,
        genre: (form.profile.genre || "").trim ? (form.profile.genre || "").trim() : form.profile.genre || "",
        marketing_cap: form.options.wizard && form.options.wizard.marketingHardCap,
        budget_cap: form.profile.budget_cap,
        talent_cap: form.profile.talent_cap,
        show_days: form.profile.show_days,
        talent_names: form.profile.talent_names,
        limit_registrations: form.profile.limit_registrations,
      });
      if (!window.XLSX) {
        flash("SheetJS failed to load — check network / CDN.", "warn");
        return;
      }
      Templates.downloadAll(profile, odooExportOpts(form));
      flash("Downloading blank .xlsx pack + odoo_event_import.csv…", "info");
    });
    if ($("#btnOdooCsv")) {
      $("#btnOdooCsv").addEventListener("click", function () {
        const form = readForm();
        Templates.downloadOdooCsv(form.profile, odooExportOpts(form));
        flash("Downloading odoo_event_import.csv…", "info");
      });
    }

    $$(".tabs button").forEach((b) => {
      b.addEventListener("click", () => showPanel(b.dataset.panel));
    });
  }

  // ===== BEGIN event-draft.v1 / Create this event =====
  const AUTOSAVE_MS = 800;
  let autosaveTimer = null;

  function draftStateFromUi() {
    const form = readForm();
    const p = form.profile;
    const ros = rosGate && rosGate.isConfirmed()
      ? { confirmed: true, rows: rosGate.getConfirmedRos().rows }
      : { confirmed: false, rows: [] };
    return {
      profile: {
        name: p.name, start_date: p.start_date, end_date: p.end_date,
        start_time: p.start_time, end_time: p.end_time, timezone: p.timezone,
        venue_name: p.venue, street: p.street, city: p.city, state: p.state, zip: p.zip,
        type: p.type, subtype: p.subtype, genre: p.genre, camping: p.camping,
        cashless: form.rfid && form.rfid.enabled ? form.rfid.cashlessMode : "",
        N: Number($("#attendance").value) || 0,
        limit_registrations: p.limit_registrations,
      },
      ga_price: form.options.ticket,
      tiers: form.options.tiers,
      ros: ros,
      mc: lastMC,
      budget: lastBudget,
      ledger: lastLedgerRows,
    };
  }

  function currentDraft() {
    return EventDraft.buildEventDraft(draftStateFromUi());
  }

  function updateCreateButtons() {
    const btn = $("#btnCreateFree");
    if (!btn || typeof EventDraft === "undefined") return;
    const issues = [];
    if (!rosGate || !rosGate.isConfirmed()) issues.push("Confirm the run of show (step 4).");
    const v = EventDraft.validateEventDraft(currentDraft());
    v.errors.forEach(function (e) { issues.push(e); });
    btn.disabled = issues.length > 0;
    const ul = $("#createEventIssues");
    if (ul) ul.innerHTML = issues.map(function (i) { return "<li>" + escapeHtml(i) + "</li>"; }).join("");
    const paid = $("#btnCreatePaid");
    if (paid && typeof CreateEvent !== "undefined") paid.href = CreateEvent.config().PAID_EVENT_URL;
  }

  function autosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
      try { localStorage.setItem(LS_KEY, JSON.stringify(readForm())); } catch (e) { /* quota / private mode */ }
      updateCreateButtons();
    }, AUTOSAVE_MS);
  }

  async function onCreateFree() {
    const btn = $("#btnCreateFree");
    const status = $("#createEventStatus");
    updateCreateButtons();
    if (!btn || btn.disabled) return;
    const draft = currentDraft();
    try { localStorage.setItem(LS_KEY, JSON.stringify(readForm())); } catch (e) {}
    btn.disabled = true;
    if (status) status.textContent = "Sending draft to Patron Journey…";
    try {
      const r = await CreateEvent.createFreeEvent(draft);
      if (status) {
        status.textContent = r.mode === "anonymous"
          ? "Draft saved. Finish sign-in / sign-up in the new tab to create your event."
          : "Event created — opening your dashboard…";
      }
    } catch (err) {
      if (status) status.textContent = "Could not create event: " + (err && err.message ? err.message : err) + ". Your inputs are still saved here.";
      flash("Create event failed — inputs kept locally.", "warn");
    } finally {
      updateCreateButtons();
    }
  }

  function wireEventDraft() {
    const sidebar = document.querySelector(".sidebar");
    const main = document.querySelector("main");
    [sidebar, main].forEach(function (root) {
      if (!root) return;
      root.addEventListener("input", autosave);
      root.addEventListener("change", autosave);
      root.addEventListener("click", function (e) {
        if (e.target && /^btnRos/.test(e.target.id || "")) setTimeout(updateCreateButtons, 0);
      });
    });
    if ($("#btnCreateFree")) $("#btnCreateFree").addEventListener("click", onCreateFree);
    try {
      if (localStorage.getItem(LS_KEY)) loadDraft();
    } catch (e) { /* ignore */ }
    updateCreateButtons();
  }
  // ===== END event-draft.v1 / Create this event =====

  function init() {
    model = window.BUDGET_MODEL;
    festivals = Array.isArray(window.FESTIVALS) ? window.FESTIVALS : [];
    if (!model) {
      flash("BUDGET_MODEL missing — check baked_data.js", "fail");
      return;
    }
    applyDefaultsToForm();
    ensureSheetBaseline();
    // Product default: music focus on (changes live vs sheet). Use Reset / Reconcile for raw sheet.
    wire();
    wireEventDraft();
    goAxStep(1);
    recalculate();
    flash(
      "Loaded Master Budget (N0=" +
        model.baseline.N0 +
        "). Festivals: " +
        festivals.length +
        ". Drafts stay in localStorage.",
      "info"
    );
    // Full festivals.json (~7.7MB, 26,780 rows) via fetch — not baked into HTML.
    // Requires static server (npx serve, python -m http.server, etc.).
    flash("Loading festivals.json…", "info");
    try {
      fetch("festivals.json", { cache: "no-store" })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!Array.isArray(data)) throw new Error("festivals.json not an array");
          festivals = data;
          window.FESTIVALS = data;
          const { profile } = readForm();
          if (lastPnL) renderCompetitors({ ...profile, N: lastPnL.N, attendance: lastPnL.N, start: profile.start_date, end: profile.end_date, category: profile.type, subcategory: profile.subtype }, lastPnL);
          flash(
            "Festivals directory loaded: " + festivals.length.toLocaleString() + " events (fetch). Historical years labeled stale.",
            "info"
          );
        })
        .catch(function (err) {
          flash(
            "Could not fetch festivals.json (" + (err && err.message ? err.message : err) + "). Serve statically: npx serve /workspace/festival-forecaster — competitor panel stays empty (never invents).",
            "warn"
          );
        });
    } catch (e) { /* ignore */ }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
