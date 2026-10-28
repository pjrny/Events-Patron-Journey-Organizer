/**
 * Sponsors / Booths — optional add-on (RFID pattern).
 * Off = G3 and K47 unchanged.
 * On  = ancillary income (+ optional site cost outside Master G3).
 * Never rewrites G34 / C48.
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

  function normalizeSponsors(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(function (r, i) {
      return {
        id: r.id || "sponsor_" + i,
        name: String(r.name != null ? r.name : "Sponsor " + (i + 1)),
        level: String(r.level != null ? r.level : "Standard"),
        type: String(r.type != null ? r.type : "cash"),
        count: Math.max(0, num(r.count, 1)),
        fee: num(r.fee, 0),
        show_on_ticket: !!r.show_on_ticket,
        source: r.source || "addon",
      };
    });
  }

  function normalizeBooths(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(function (r, i) {
      return {
        id: r.id || "booth_" + i,
        category: String(r.category != null ? r.category : "General"),
        count: Math.max(0, num(r.count, 1)),
        price: num(r.price, 0),
        creates_sponsor: !!r.creates_sponsor,
        source: r.source || "addon",
      };
    });
  }

  /**
   * computeSponsorsBooths({ enabled, sponsors, booths, site_cost })
   * → income, site_cost, lines; when !enabled all zeros.
   */
  function computeSponsorsBooths(opts) {
    opts = opts || {};
    const enabled = !!opts.enabled;
    const sponsors = normalizeSponsors(opts.sponsors);
    const booths = normalizeBooths(opts.booths);
    const siteCost = Math.max(0, num(opts.site_cost, 0));

    if (!enabled) {
      return {
        enabled: false,
        sponsors: sponsors,
        booths: booths,
        sponsor_income: 0,
        booth_income: 0,
        income: 0,
        site_cost: 0,
        lines: [],
        assumption_note: null,
        bucket_label: "Sponsors / Booths (optional)",
      };
    }

    const lines = [];
    let sponsor_income = 0;
    sponsors.forEach(function (s) {
      const ext = round2(s.count * s.fee);
      sponsor_income += ext;
      lines.push({
        id: s.id,
        kind: "sponsor",
        label: s.name + " (" + s.level + ")",
        qty: s.count,
        unit_price: s.fee,
        extended: ext,
        source: "addon",
      });
    });
    let booth_income = 0;
    booths.forEach(function (b) {
      const ext = round2(b.count * b.price);
      booth_income += ext;
      lines.push({
        id: b.id,
        kind: "booth",
        label: "Booth · " + b.category,
        qty: b.count,
        unit_price: b.price,
        extended: ext,
        source: "addon",
      });
    });
    sponsor_income = round2(sponsor_income);
    booth_income = round2(booth_income);
    const income = round2(sponsor_income + booth_income);

    return {
      enabled: true,
      sponsors: sponsors,
      booths: booths,
      sponsor_income: sponsor_income,
      booth_income: booth_income,
      income: income,
      site_cost: siteCost,
      lines: lines,
      assumption_note:
        "ASSUMPTION: sponsor/booth income adds to live K47; optional site cost adds to live opex outside Master G3. Does not rewrite G34 or C48.",
      bucket_label: "Sponsors / Booths (optional)",
    };
  }

  global.SponsorsBooths = {
    computeSponsorsBooths: computeSponsorsBooths,
    normalizeSponsors: normalizeSponsors,
    normalizeBooths: normalizeBooths,
  };
})(typeof window !== "undefined" ? window : global);
