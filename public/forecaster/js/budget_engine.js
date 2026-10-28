/**
 * Festival Forecaster — deterministic P&L engine from budget_model.json
 * Workbook formulas win. Cell refs documented for UI tooltips.
 */
(function (global) {
  "use strict";

  const TOL = 1.0;

  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function deptBeRate(dept) {
    const lines = dept.lines || [];
    if (dept.id === "misc") {
      // Sheet F58 = SUM(F47:F53) — first 7 lines only
      return lines.slice(0, 7).reduce((s, l) => s + num(l.be_rate, 0), 0);
    }
    return lines.reduce((s, l) => s + num(l.be_rate, 0), 0);
  }

  function isCcFeeLine(line) {
    return (
      line.cell === "C54" ||
      line.id === "ticket_company_credit_card_processing_fees" ||
      (typeof line.formula === "string" && line.formula.includes("K22"))
    );
  }

  /**
   * Cost for a single line at attendance N.
   * C54 CC fees MUST be 0.03 * K22 dynamically (not frozen baseline).
   */
  function lineCost(line, N, ctx) {
    const { revenue, k2, ccFeeRate, N0 } = ctx;

    if (isCcFeeLine(line)) {
      const rate = num(line.be_rate, ccFeeRate != null ? ccFeeRate : 0.03);
      return rate * num(revenue, 0);
    }

    switch (line.type) {
      case "fixed": {
        const amt = num(line.amount, 0);
        if (line.scale_with_N && N0) return amt * (N / N0);
        return amt;
      }
      case "per_ticket":
        return num(line.rate, 0) * N;
      case "hybrid": {
        const h = line.hybrid || {};
        return num(h.per_ticket_rate, num(line.rate, 0)) * N + num(h.fixed_addend, 0);
      }
      case "pct_of_revenue":
        return num(line.rate, 0) * num(revenue, 0);
      case "sales_tax":
        // C80 = 0.10 * N * K2 * 0.15
        return num(line.rate, 0.1) * N * num(k2, 0) * 0.15;
      default:
        throw new Error("Unknown line type: " + line.type + " (" + line.id + ")");
    }
  }

  function ticketRevenueK22(opts) {
    const warnings = [];
    const ticketBuild = opts.ticketBuild;

    if (Array.isArray(ticketBuild) && ticketBuild.length > 0) {
      let R = 0;
      let qtySum = 0;
      for (const row of ticketBuild) {
        const price = num(row.price, 0);
        const qty = num(row.qty, 0);
        R += price * qty;
        qtySum += qty;
      }
      if (Math.abs(qtySum - opts.N) > 0.5) {
        warnings.push(
          "WARN: ticket-build Σqty (" + qtySum + ") ≠ N (" + opts.N + "). Using build revenue only; not mixed with K22."
        );
      }
      return { R, warnings, mode: "ticket_build", qtySum };
    }

    const ticket = num(opts.ticket, 199);
    const campFee = num(opts.camp_fee, 45.5);
    const pCamp = num(opts.p_camp, 0.9);
    const svc = num(opts.service_fee_rate, 0.03);
    const campProc = num(opts.camper_processing, 3);
    const nonProc = num(opts.noncamper_processing, 1);
    const N = opts.N;

    // K14 P_camper = ticket + camp_fee + 0.03*(ticket+camp_fee) + 3
    const P_camper = ticket + campFee + svc * (ticket + campFee) + campProc;
    // K19 P_noncamper = ticket + 0.03*ticket + 1
    const P_noncamper = ticket + svc * ticket + nonProc;
    // K22
    const R = N * pCamp * P_camper + N * (1 - pCamp) * P_noncamper;

    return {
      R,
      warnings,
      mode: "k22",
      P_camper,
      P_noncamper,
      components: {
        K12: svc * (ticket + campFee),
        K13: campProc,
        K14: P_camper,
        K17: svc * ticket,
        K18: nonProc,
        K19: P_noncamper,
      },
    };
  }

  function computeBreakEvenK2(model) {
    const depts = Object.fromEntries(model.departments.map((d) => [d.id, d]));
    const be = {
      B17: deptBeRate(depts.site),
      B49: deptBeRate(depts.production) + deptBeRate(depts.talent),
      B58: deptBeRate(depts.ticketing),
      B75: deptBeRate(depts.staff),
      B81: deptBeRate(depts.annual_ops),
      F34: deptBeRate(depts.marketing),
      F44: deptBeRate(depts.pre_production),
      F58: deptBeRate(depts.misc),
    };
    const K2 =
      be.B17 + be.B49 + be.B58 + be.B75 + be.B81 + be.F34 + be.F44 + be.F58;
    return { K2, be };
  }

  function sumDept(dept, N, ctx) {
    return (dept.lines || []).reduce((s, l) => s + lineCost(l, N, ctx), 0);
  }

  /**
   * Core compute. options override defaults / apply wizard after base.
   */
  function compute(model, options) {
    options = options || {};
    const N0 = num(model.baseline.N0, 7888);
    const d = model.defaults;
    const N = num(options.N, N0);

    const ticket = num(options.ticket, d.ticket);
    const camp_fee = num(options.camp_fee, d.camp_fee);
    const p_camp = num(options.p_camp, d.p_camp);
    const service_fee_rate = num(options.service_fee_rate, d.service_fee_rate);
    const camper_processing = num(options.camper_processing, d.camper_processing);
    const noncamper_processing = num(
      options.noncamper_processing,
      d.noncamper_processing
    );
    const ccFeeRate = num(options.cc_fee_rate, d.cc_fee_rate);

    const rev = ticketRevenueK22({
      N,
      ticket,
      camp_fee,
      p_camp,
      service_fee_rate,
      camper_processing,
      noncamper_processing,
      ticketBuild: options.ticketBuild,
    });
    const R = rev.R;
    const warnings = rev.warnings.slice();

    const { K2, be } = computeBreakEvenK2(model);

    const depts = Object.fromEntries(model.departments.map((dep) => [dep.id, dep]));
    const ctx = { revenue: R, k2: K2, ccFeeRate, N0 };

    let site = sumDept(depts.site, N, ctx);
    let production = sumDept(depts.production, N, ctx);
    let talent = sumDept(depts.talent, N, ctx);
    let marketing = sumDept(depts.marketing, N, ctx);
    let pre_production = sumDept(depts.pre_production, N, ctx);
    let misc = sumDept(depts.misc, N, ctx);
    let ticketing = sumDept(depts.ticketing, N, ctx);
    let staff = sumDept(depts.staff, N, ctx);
    let annual_ops = sumDept(depts.annual_ops, N, ctx);

    const base = {
      site,
      production,
      talent,
      marketing,
      pre_production,
      misc,
      ticketing,
      staff,
      annual_ops,
    };

    // --- Wizard modifiers AFTER base ---
    const wiz = options.wizard || {};

    // Music focus: yes talent×1.5; no talent×0.5; omit = no change
    if (wiz.musicFocus === true || wiz.musicFocus === "yes") {
      talent *= 1.5;
    } else if (wiz.musicFocus === false || wiz.musicFocus === "no") {
      talent *= 0.5;
    }

    // Experience focus: production×2, talent×0.25
    if (wiz.experienceFocus === true || wiz.experienceFocus === "yes") {
      production *= 2;
      talent *= 0.25;
    }

    // Camping on: site + annual_ops ×1.10
    if (wiz.camping === true || wiz.camping === "on" || wiz.camping === "yes") {
      site *= 1.1;
      annual_ops *= 1.1;
    }

    // Last-minute production: production×1.20
    if (wiz.lastMinuteProduction === true || wiz.lastMinuteProduction === "yes") {
      production *= 1.2;
    }

    // Marketing slider 5–40% (default 16%): replace marketing as % of opex
    const marketingPct = clamp(
      num(wiz.marketingPct, options.marketingPct != null ? options.marketingPct : null),
      5,
      40,
      null
    );
    let marketingRequired = marketing;
    let marketingHardCap = num(wiz.marketingHardCap, options.marketingHardCap);
    let marketingNote = null;

    if (marketingPct != null) {
      const other =
        site +
        production +
        talent +
        pre_production +
        misc +
        ticketing +
        staff +
        annual_ops;
      // marketing = pct * total_opex => marketing = (pct/(1-pct)) * other
      const p = marketingPct / 100;
      marketingRequired = (p / (1 - p)) * other;
      marketing = marketingRequired;
      if (Number.isFinite(marketingHardCap) && marketingHardCap >= 0) {
        if (marketing > marketingHardCap) {
          marketingNote =
            "Marketing required $" +
            round2(marketingRequired) +
            " exceeds hard cap $" +
            round2(marketingHardCap) +
            "; capped (cap does not invent revenue).";
          marketing = marketingHardCap;
        }
      }
    }

    const production_incl_talent = production + talent;
    const misc_guest = pre_production + misc;
    // Master Budget G3 only (sheet target) — never includes RFID or Safety/Weather add-ons
    const G3_master =
      site +
      production_incl_talent +
      ticketing +
      staff +
      annual_ops +
      marketing +
      pre_production +
      misc;

    // Optional RFID / Cashless (Basic Scenario) — additive to LIVE forecast only
    const rfidOpts = options.rfid || {};
    const rfidEnabled = !!rfidOpts.enabled;
    let rfidEstimate = {
      enabled: false,
      lines: [],
      subtotal: 0,
      consumer_passthrough: null,
      bucket_label: "RFID / Cashless (Basic Scenario)",
    };
    if (
      rfidEnabled &&
      typeof global.RfidAddon !== "undefined" &&
      global.RfidAddon &&
      typeof global.RfidAddon.computeRfidEstimate === "function"
    ) {
      rfidEstimate = global.RfidAddon.computeRfidEstimate({
        N: N,
        enabled: true,
        qtyOverrides: rfidOpts.qtyOverrides || {},
      });
    } else if (rfidEnabled) {
      // Fallback if addon script missing — still zero so we don't invent
      rfidEstimate = {
        enabled: true,
        lines: [],
        subtotal: 0,
        consumer_passthrough: null,
        bucket_label: "RFID / Cashless (Basic Scenario)",
        warning: "RfidAddon not loaded",
      };
    }
    const rfid_subtotal = rfidEnabled ? num(rfidEstimate.subtotal, 0) : 0;

    // Optional Safety / Weather — additive to LIVE forecast only (outside Master G3)
    const swOpts = options.safetyWeather || options.safety_weather || {};
    const swEnabled = !!swOpts.enabled;
    let swEstimate = {
      enabled: false,
      lines: [],
      subtotal: 0,
      bucket_label: "Safety / Weather (optional)",
    };
    if (
      swEnabled &&
      typeof global.SafetyWeather !== "undefined" &&
      global.SafetyWeather &&
      typeof global.SafetyWeather.computeSafetyWeatherEstimate === "function"
    ) {
      swEstimate = global.SafetyWeather.computeSafetyWeatherEstimate({
        enabled: true,
        N: N,
        peak_occupancy: swOpts.peak_occupancy != null ? swOpts.peak_occupancy : N,
        show_days: swOpts.show_days,
        load_in_days: swOpts.load_in_days,
        camping:
          swOpts.camping != null
            ? swOpts.camping
            : wiz.camping === "on" || wiz.camping === true,
        venue_mode: swOpts.venue_mode,
        weather_service_budget: swOpts.weather_service_budget,
        cancellation_reserve_pct: swOpts.cancellation_reserve_pct,
        master_opex: G3_master,
        qtyOverrides: swOpts.qtyOverrides || {},
        ahj_fire_permit_status: swOpts.ahj_fire_permit_status,
        lightning_stand_down_miles: swOpts.lightning_stand_down_miles,
        wind_hold_mph: swOpts.wind_hold_mph,
        heat_index_cold_trigger: swOpts.heat_index_cold_trigger,
        nearest_hospital_minutes: swOpts.nearest_hospital_minutes,
      });
    } else if (swEnabled) {
      swEstimate = {
        enabled: true,
        lines: [],
        subtotal: 0,
        bucket_label: "Safety / Weather (optional)",
        warning: "SafetyWeather not loaded",
      };
    }
    const safety_weather_subtotal = swEnabled ? num(swEstimate.subtotal, 0) : 0;

    // Optional Sponsors / Booths — income + optional site cost (outside Master G3)
    const sbOpts = options.sponsorsBooths || options.sponsors_booths || {};
    const sbEnabled = !!sbOpts.enabled;
    let sbEstimate = {
      enabled: false,
      income: 0,
      site_cost: 0,
      sponsor_income: 0,
      booth_income: 0,
      lines: [],
      bucket_label: "Sponsors / Booths (optional)",
    };
    if (
      sbEnabled &&
      typeof global.SponsorsBooths !== "undefined" &&
      global.SponsorsBooths &&
      typeof global.SponsorsBooths.computeSponsorsBooths === "function"
    ) {
      sbEstimate = global.SponsorsBooths.computeSponsorsBooths({
        enabled: true,
        sponsors: sbOpts.sponsors || [],
        booths: sbOpts.booths || [],
        site_cost: sbOpts.site_cost,
      });
    } else if (sbEnabled) {
      sbEstimate = {
        enabled: true,
        income: 0,
        site_cost: num(sbOpts.site_cost, 0),
        sponsor_income: 0,
        booth_income: 0,
        lines: [],
        bucket_label: "Sponsors / Booths (optional)",
        warning: "SponsorsBooths not loaded",
      };
    }
    const sponsors_booths_income = sbEnabled ? num(sbEstimate.income, 0) : 0;
    const sponsors_booths_site_cost = sbEnabled ? num(sbEstimate.site_cost, 0) : 0;

    // Live total opex = Master Budget G3 + optional RFID + Safety/Weather + sponsor site cost
    const total_opex =
      G3_master + rfid_subtotal + safety_weather_subtotal + sponsors_booths_site_cost;

    // Ancillaries: default scale amount*(N/N0); user-overridable
    const ancOverrides = options.ancillaryOverrides || {};
    const ancScale = options.scaleAncillaries !== false;
    const ancLines = (model.ancillaries || []).map((a) => {
      let amount;
      if (Object.prototype.hasOwnProperty.call(ancOverrides, a.id)) {
        amount = num(ancOverrides[a.id], a.amount);
      } else if (ancScale) {
        amount = num(a.amount, 0) * (N / N0);
      } else {
        amount = num(a.amount, 0);
      }
      return { id: a.id, label: a.label, cell: a.cell, amount };
    });
    const ancTotal = ancLines.reduce((s, a) => s + a.amount, 0);

    const kickback = num(
      options.ticket_kickback,
      (model.addbacks.find((x) => x.id === "ticket_kickback") || {}).amount || 0
    );
    const owner = num(
      options.owner_salary_addback,
      (model.addbacks.find((x) => x.id === "owner_salary_addback") || {}).amount || 0
    );

    // K24 = R - opex; K30 = K24 + kickback + owner; K47 = K24 + anc + kickback + owner + sponsor/booth income
    const K24 = R - total_opex;
    const K30 = K24 + kickback + owner;
    const K47 = K24 + ancTotal + kickback + owner + sponsors_booths_income;

    return {
      N,
      N0,
      ticket,
      camp_fee,
      p_camp,
      revenue_mode: rev.mode,
      P_camper: rev.P_camper,
      P_noncamper: rev.P_noncamper,
      revenue_components: rev.components || null,
      K2,
      be,
      K22: R,
      K23: N ? R / N : 0,
      departments: {
        site,
        production,
        talent,
        production_incl_talent,
        marketing,
        pre_production,
        misc,
        misc_guest,
        ticketing,
        staff,
        annual_ops,
      },
      base_departments: base,
      G3: G3_master,
      G3_master: G3_master,
      total_opex: total_opex,
      rfid: rfidEstimate,
      rfid_subtotal: rfid_subtotal,
      rfid_enabled: rfidEnabled,
      safety_weather: swEstimate,
      safety_weather_subtotal: safety_weather_subtotal,
      safety_weather_enabled: swEnabled,
      sponsors_booths: sbEstimate,
      sponsors_booths_income: sponsors_booths_income,
      sponsors_booths_site_cost: sponsors_booths_site_cost,
      sponsors_booths_enabled: sbEnabled,
      ancillaries: ancLines,
      ancTotal,
      kickback,
      owner,
      K24,
      K30,
      K47,
      marketingPct,
      marketingRequired,
      marketingHardCap: Number.isFinite(marketingHardCap) ? marketingHardCap : null,
      marketingNote,
      warnings,
      cells: {
        C17: site,
        C48: talent,
        C49: production_incl_talent,
        production_ex_talent: production,
        G34: marketing,
        C58: ticketing,
        C75: staff,
        C81: annual_ops,
        G44: pre_production,
        G58: misc,
        misc_guest_exp: misc_guest,
        G3: G3_master,
        K2,
        K22: R,
        K24,
        K30,
        K47,
      },
    };
  }

  function clamp(v, lo, hi, ifNull) {
    if (v == null || !Number.isFinite(v)) return ifNull;
    return Math.min(hi, Math.max(lo, v));
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /**
   * Reconcile at N0 vs sheet_targets_at_N0 — assert within $1.
   */
  function reconcileAtN0(model) {
    const N0 = model.baseline.N0;
    // Baseline reconcile: no wizard, ancillaries NOT scaled (sheet uses fixed K33:K45)
    const result = compute(model, {
      N: N0,
      scaleAncillaries: false,
      wizard: {},
      rfid: { enabled: false },
      safetyWeather: { enabled: false },
      sponsorsBooths: { enabled: false },
    });
    const targets = model.sheet_targets_at_N0;
    const rows = [
      ["C17 Site", targets.C17, result.cells.C17],
      ["C48 Talent", targets.C48, result.cells.C48],
      ["C49-C48 Production", targets.production_ex_talent, result.cells.production_ex_talent],
      ["G34 Marketing", targets.G34, result.cells.G34],
      ["C58 Ticketing", targets.C58, result.cells.C58],
      ["C75 Staff", targets.C75, result.cells.C75],
      ["C81 Annual ops", targets.C81, result.cells.C81],
      ["G44+G58 Misc/guest", targets.misc_guest_exp, result.cells.misc_guest_exp],
      ["G3 Total opex", targets.G3, result.cells.G3],
      ["K2 Break-even ticket", targets.K2, result.cells.K2],
      ["K22 Ticket revenue", targets.K22, result.cells.K22],
      ["K24 Profit pre-ancillary", targets.K24, result.cells.K24],
      ["K30 After addbacks", targets.K30, result.cells.K30],
      ["K47 Full profit", targets.K47, result.cells.K47],
    ];
    const beRows = [
      ["B17", targets.B17, result.be.B17],
      ["B49", targets.B49, result.be.B49],
      ["B58", targets.B58, result.be.B58],
      ["B75", targets.B75, result.be.B75],
      ["B81", targets.B81, result.be.B81],
      ["F34", targets.F34, result.be.F34],
      ["F44", targets.F44, result.be.F44],
      ["F58", targets.F58, result.be.F58],
    ];

    function check(rowsList, tol) {
      return rowsList.map(([label, sheet, modelV]) => {
        const delta = modelV - sheet;
        return {
          label,
          sheet,
          model: modelV,
          delta,
          pass: Math.abs(delta) <= tol,
        };
      });
    }

    const dollar = check(rows, TOL);
    const rates = check(beRows, 0.01);
    const allPass = dollar.every((r) => r.pass) && rates.every((r) => r.pass);

    return {
      pass: allPass,
      N: N0,
      dollar,
      rates,
      result,
    };
  }

  global.BudgetEngine = {
    compute,
    reconcileAtN0,
    ticketRevenueK22,
    computeBreakEvenK2,
    lineCost,
    deptBeRate,
    TOL,
  };
})(typeof window !== "undefined" ? window : global);
