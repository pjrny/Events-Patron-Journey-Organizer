/**
 * Ticket tiers (Odoo-style) — optional revenue path for K22.
 * Default reconstruction from sheet K7/K6/K8 → K14/K19 all-in prices
 * so sum(qty_i * price_i) ≡ workbook K22 at any N (camping mix unchanged).
 *
 * ASSUMPTION: max + sales window affect ONLY Monte Carlo attendance shocks
 * (cannot exceed max; short window → higher walk-up variance). They do not
 * change deterministic P&L.
 */
(function (global) {
  "use strict";

  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /**
   * Sheet all-in prices (K14 / K19) from K7/K6 + fees.
   */
  function sheetAllInPrices(defaults) {
    const d = defaults || {};
    const ticket = num(d.ticket, 199);
    const campFee = num(d.camp_fee, 45.5);
    const svc = num(d.service_fee_rate, 0.03);
    const campProc = num(d.camper_processing, 3);
    const nonProc = num(d.noncamper_processing, 1);
    const P_camper = ticket + campFee + svc * (ticket + campFee) + campProc;
    const P_noncamper = ticket + svc * ticket + nonProc;
    return {
      ticket: ticket,
      camp_fee: campFee,
      p_camp: num(d.p_camp, 0.9),
      service_fee_rate: svc,
      camper_processing: campProc,
      noncamper_processing: nonProc,
      P_camper: P_camper,
      P_noncamper: P_noncamper,
    };
  }

  /**
   * Default tiers reconstructing sheet K22.
   *
   * How default reconstructs K22 (document for UI/ledger):
   *   Camper GA:     price = K14 = ticket + camp_fee + 0.03*(ticket+camp_fee) + 3
   *                  qty   = N * K8 (p_camp)
   *   Non-camper GA: price = K19 = ticket + 0.03*ticket + 1
   *                  qty   = N * (1 − K8)
   *   Revenue = Σ(qty_i × price_i) ≡ N·p_camp·P_camper + N·(1−p_camp)·P_noncamper = sheet K22
   * Camping mix unchanged; K6/K7 embedded in all-in tier prices (not a separate camp line).
   *
   * User VIP/day tiers: face prices in rows; optional camp_separate adds
   * camp_fee × N × p_camp (workbook-style separate camp fee, without re-baking svc/proc).
   */
  function defaultTiersFromSheet(defaults, N, salesWindow) {
    const prices = sheetAllInPrices(defaults);
    const n = Math.max(0, num(N, 0));
    const pCamp = prices.p_camp;
    const qCamp = n * pCamp;
    const qNon = n * (1 - pCamp);
    const win = salesWindow || {};
    const start = win.sales_start || "";
    const end = win.sales_end || "";
    return [
      {
        id: "ga_camper",
        name: "GA Camper",
        price: prices.P_camper,
        max: Math.ceil(qCamp) || 0,
        sales_start: start,
        sales_end: end,
        expected_qty: qCamp,
        source: "sheet",
      },
      {
        id: "ga_noncamper",
        name: "GA Non-camper",
        price: prices.P_noncamper,
        max: Math.ceil(qNon) || 0,
        sales_start: start,
        sales_end: end,
        expected_qty: qNon,
        source: "sheet",
      },
    ];
  }

  /**
   * Normalize tier rows from UI / draft.
   */
  function normalizeTiers(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(function (row, i) {
      return {
        id: row.id || "tier_" + i,
        name: String(row.name != null ? row.name : "Tier " + (i + 1)),
        price: num(row.price, 0),
        max: row.max === "" || row.max == null ? null : num(row.max, null),
        sales_start: row.sales_start || "",
        sales_end: row.sales_end || "",
        expected_qty: num(row.expected_qty, 0),
        source: row.source || "odoo-tier",
      };
    });
  }

  /**
   * Compute tier revenue + validation.
   * opts: { N, camp_separate, camp_fee, p_camp, enabled }
   */
  function computeTierRevenue(tiers, opts) {
    opts = opts || {};
    const enabled = !!opts.enabled;
    const N = num(opts.N, 0);
    const rows = normalizeTiers(tiers);

    if (!enabled) {
      return {
        enabled: false,
        tiers: rows,
        ticketBuild: null,
        revenue: null,
        qtySum: 0,
        campAddon: 0,
        error: null,
        reconstruction_note:
          "Tiers OFF — engine uses sheet K22 (K7/K6/K8 camper/non-camper).",
      };
    }

    let qtySum = 0;
    let faceRevenue = 0;
    const ticketBuild = rows.map(function (t) {
      const qty = num(t.expected_qty, 0);
      const price = num(t.price, 0);
      qtySum += qty;
      faceRevenue += price * qty;
      return {
        name: t.name,
        price: price,
        qty: qty,
        max: t.max,
        sales_start: t.sales_start,
        sales_end: t.sales_end,
        source: t.source,
      };
    });

    let campAddon = 0;
    if (opts.camp_separate) {
      // Workbook-style separate camp: camp_fee * N * p_camp (face only; svc/proc stay in tier prices if user put them there)
      campAddon = num(opts.camp_fee, 0) * N * num(opts.p_camp, 0);
      if (campAddon > 0) {
        ticketBuild.push({
          name: "Camping fee (separate)",
          price: num(opts.camp_fee, 0),
          qty: N * num(opts.p_camp, 0),
          max: null,
          sales_start: "",
          sales_end: "",
          source: "sheet",
        });
      }
    }

    const revenue = faceRevenue + campAddon;
    let error = null;
    if (Math.abs(qtySum - N) > 0.5) {
      error =
        "Tier expected_qty sum (" +
        round2(qtySum) +
        ") ≠ N (" +
        N +
        "). Fix tiers before Monte Carlo.";
    }

    // Capacity check informational (MC enforces)
    const maxTotal = rows.reduce(function (s, t) {
      if (t.max == null || !Number.isFinite(t.max)) return s;
      return s + t.max;
    }, 0);
    const hasMax = rows.some(function (t) {
      return t.max != null && Number.isFinite(t.max);
    });

    return {
      enabled: true,
      tiers: rows,
      ticketBuild: ticketBuild,
      revenue: revenue,
      qtySum: qtySum,
      campAddon: campAddon,
      camp_separate: !!opts.camp_separate,
      error: error,
      capacity_max: hasMax ? maxTotal : null,
      reconstruction_note: opts.camp_separate
        ? "Revenue = Σ(qty×price) + camp_fee×N×p_camp (camp separate as workbook)."
        : "Default all-in K14/K19 tiers: Σ(qty×price) ≡ sheet K22; camping mix via qty split on K8.",
    };
  }

  /**
   * Sales-window length in days (ASSUMPTION helper for MC walk-up variance).
   * Missing dates → null (no extra variance).
   */
  function salesWindowDays(tier) {
    if (!tier || !tier.sales_start || !tier.sales_end) return null;
    const a = Date.parse(tier.sales_start);
    const b = Date.parse(tier.sales_end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  }

  /**
   * Aggregate MC attendance constraints from tiers.
   * ASSUMPTION only — does not change deterministic P&L.
   * Returns { maxAttendance, walkUpVarianceBoost }
   *   maxAttendance: sum of tier.max when all tiers have max; else null
   *   walkUpVarianceBoost: 0–1; short windows → higher (more walk-up shock width)
   */
  function mcAttendanceConstraints(tiers, N) {
    const rows = normalizeTiers(tiers);
    if (!rows.length) {
      return { maxAttendance: null, walkUpVarianceBoost: 0, note: null };
    }
    let allHaveMax = true;
    let maxSum = 0;
    let minDays = Infinity;
    let anyWindow = false;
    rows.forEach(function (t) {
      if (t.max == null || !Number.isFinite(t.max)) allHaveMax = false;
      else maxSum += t.max;
      const d = salesWindowDays(t);
      if (d != null) {
        anyWindow = true;
        if (d < minDays) minDays = d;
      }
    });
    // Short window ASSUMPTION: < 14 days → boost up to 1.0; 90+ days → 0
    let walkUp = 0;
    if (anyWindow && Number.isFinite(minDays)) {
      if (minDays >= 90) walkUp = 0;
      else if (minDays <= 14) walkUp = 1;
      else walkUp = (90 - minDays) / (90 - 14);
    }
    return {
      maxAttendance: allHaveMax ? maxSum : null,
      walkUpVarianceBoost: walkUp,
      note:
        "ASSUMPTION: tier max caps MC attendance; short sales window raises walk-up variance. Deterministic K22 unchanged by max/window.",
    };
  }

  /**
   * Apply limit_registrations cap to N (optional). Off/null/≤0 = no change.
   */
  function applyLimitRegistrations(N, limit) {
    const n = Math.max(0, num(N, 0));
    const lim = num(limit, 0);
    if (!lim || lim <= 0) return n;
    return Math.min(n, lim);
  }

  global.TicketTiers = {
    sheetAllInPrices: sheetAllInPrices,
    defaultTiersFromSheet: defaultTiersFromSheet,
    normalizeTiers: normalizeTiers,
    computeTierRevenue: computeTierRevenue,
    salesWindowDays: salesWindowDays,
    mcAttendanceConstraints: mcAttendanceConstraints,
    applyLimitRegistrations: applyLimitRegistrations,
  };
})(typeof window !== "undefined" ? window : global);
