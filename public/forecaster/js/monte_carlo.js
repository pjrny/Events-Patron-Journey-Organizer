/**
 * Monte Carlo risk band — 5000 draws, deterministic shocks around base P&L.
 */
(function (global) {
  "use strict";

  const PRESETS = {
    conservative: { label: "Conservative", attnLo: -0.25, attnHi: 0.05 },
    base: { label: "Base", attnLo: -0.15, attnHi: 0.1 },
    aggressive: { label: "Aggressive", attnLo: -0.08, attnHi: 0.18 },
  };

  function numLimit(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Triangular on [lo, hi] with mode at 0 (relative shock), mapped to [1+lo, 1+hi]. */
  function triangular01(rng, lo, hi) {
    // mode at 0 within [lo,hi]
    const a = lo;
    const b = hi;
    const c = 0;
    const u = rng();
    const fc = (c - a) / (b - a);
    let x;
    if (u < fc) {
      x = a + Math.sqrt(u * (b - a) * (c - a));
    } else {
      x = b - Math.sqrt((1 - u) * (b - a) * (b - c));
    }
    return 1 + x;
  }

  function lognormalRightSkew(rng, sigma) {
    // Box-Muller then exp; mean of underlying ~0 so E[exp] = exp(sig^2/2)
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const raw = Math.exp(sigma * z);
    // normalize so median ≈ 1
    return raw / Math.exp(0); // median of lognormal(0,σ) is 1
  }

  function betaSample(rng, a, b) {
    // Gamma via Marsaglia for shape>=1, else boost
    function gamma(shape) {
      if (shape < 1) {
        return gamma(shape + 1) * Math.pow(rng(), 1 / shape);
      }
      const d = shape - 1 / 3;
      const c = 1 / Math.sqrt(9 * d);
      for (;;) {
        let x, v;
        do {
          const u1 = Math.max(rng(), 1e-12);
          const u2 = rng();
          x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          v = 1 + c * x;
        } while (v <= 0);
        v = v * v * v;
        const u = rng();
        if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
      }
    }
    const x = gamma(a);
    const y = gamma(b);
    return x / (x + y);
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const i = (sorted.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    if (lo === hi) return sorted[lo];
    return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
  }

  /**
   * Run MC around a base scenario.
   * shocks: attendance triangular, avg ticket, talent lognormal, production,
   * sponsor beta, camp mix, on-site spend.
   */
  function run(model, baseOptions, opts) {
    opts = opts || {};
    const draws = opts.draws || 5000;
    const presetName = opts.preset || "base";
    const preset = PRESETS[presetName] || PRESETS.base;
    const rng = mulberry32(opts.seed != null ? opts.seed : 42);
    const engine = global.BudgetEngine;

    const base = engine.compute(model, baseOptions);
    const nets = [];
    const coverTickets = []; // K22 > opex?
    const profits = [];
    const drawsDetail = []; // representative-draw helpers (does not change math)

    const weatherCtx = resolveWeatherContext(baseOptions);
    const wImpact = weatherCtx.weatherImpact; // 0 indoor, 0.5 hybrid, 1 outdoor
    const rainIndex = weatherCtx.rainIndex; // 1–10 or null

    // Limit Registrations + tier max / sales-window ASSUMPTION (MC attendance only)
    const limitReg = numLimit(baseOptions && baseOptions.limit_registrations);
    const tierConstr =
      baseOptions &&
      baseOptions.tiers &&
      baseOptions.tiers.enabled &&
      typeof global.TicketTiers !== "undefined" &&
      global.TicketTiers &&
      typeof global.TicketTiers.mcAttendanceConstraints === "function"
        ? global.TicketTiers.mcAttendanceConstraints(
            baseOptions.tiers.rows || baseOptions.tiers.tiers || [],
            base.N
          )
        : { maxAttendance: null, walkUpVarianceBoost: 0 };

    for (let i = 0; i < draws; i++) {
      // Short sales window → widen attendance triangle slightly (ASSUMPTION)
      let attnLo = preset.attnLo;
      let attnHi = preset.attnHi;
      const boost = tierConstr.walkUpVarianceBoost || 0;
      if (boost > 0) {
        attnLo = attnLo - 0.05 * boost;
        attnHi = attnHi + 0.08 * boost;
      }
      const attnMult = triangular01(rng, attnLo, attnHi);
      const ticketMult = 1 + (rng() - 0.5) * 0.16; // ±8% avg ticket
      const talentMult = lognormalRightSkew(rng, 0.22); // right-skew cost risk
      const prodMult = 0.9 + rng() * 0.25; // 0.9–1.15
      const sponsorFrac = betaSample(rng, 2, 5); // sponsor realization 0–1-ish, mean ~0.29
      let campMix = Math.min(0.99, Math.max(0.05, base.p_camp + (rng() - 0.5) * 0.2));
      let onsiteMult = 0.7 + rng() * 0.6; // 0.7–1.3 on-site / ancillaries

      // Weather (climatology) driver — outdoor/hybrid only when rain_index available
      let weatherAttn = 1;
      let weatherCost = 1;
      let weatherOnsite = 1;
      if (wImpact > 0 && rainIndex != null) {
        const wx = weatherShocks(rng, rainIndex, campMix, wImpact);
        weatherAttn = wx.attnMult;
        weatherCost = wx.costMult;
        weatherOnsite = wx.onsiteMult;
        campMix = wx.campMix;
        onsiteMult = onsiteMult * weatherOnsite;
      }

      let N = Math.max(1, Math.round(base.N * attnMult * weatherAttn));
      // Cap MC attendance: Limit Registrations, then tier max (ASSUMPTION)
      if (limitReg > 0) N = Math.min(N, limitReg);
      if (tierConstr.maxAttendance != null && Number.isFinite(tierConstr.maxAttendance)) {
        N = Math.min(N, Math.max(1, Math.round(tierConstr.maxAttendance)));
      }
      const ticket = base.ticket * ticketMult;

      const r = engine.compute(model, {
        ...baseOptions,
        N,
        ticket,
        p_camp: campMix,
        scaleAncillaries: true,
        wizard: (baseOptions && baseOptions.wizard) || {},
        ancillaryOverrides: scaleAncs(base, onsiteMult, sponsorFrac),
      });

      // Apply talent/production shocks on top of computed departments by adjusting net
      // Weather pulls production/site/safety costs up via weatherCost
      const talentShock = r.departments.talent * (talentMult - 1);
      const prodShock = r.departments.production * (prodMult * weatherCost - 1);
      const siteShock = r.departments.site * (weatherCost - 1);
      const safetyShock =
        (r.safety_weather_subtotal || 0) * (weatherCost - 1);
      const net = r.K47 - talentShock - prodShock - siteShock - safetyShock;
      const opexAdj = r.total_opex + talentShock + prodShock + siteShock + safetyShock;
      const ticketsCover = r.K22 > opexAdj;

      nets.push(net);
      profits.push(net > 0 ? 1 : 0);
      coverTickets.push(ticketsCover ? 1 : 0);
      drawsDetail.push({
        i: i,
        net: net,
        N: N,
        baseN: base.N,
        baseNet: base.K47,
        K22: r.K22,
        opexAdj: opexAdj,
        shocks: {
          attnMult: attnMult,
          ticketMult: ticketMult,
          talentMult: talentMult,
          prodMult: prodMult,
          sponsorFrac: sponsorFrac,
          campMix: campMix,
          campMixDelta: campMix - base.p_camp,
          onsiteMult: onsiteMult,
          weatherAttn: weatherAttn,
          weatherCost: weatherCost,
          weatherOnsite: weatherOnsite,
        },
      });
    }

    nets.sort((a, b) => a - b);
    const P10 = percentile(nets, 0.1);
    const P50 = percentile(nets, 0.5);
    const P90 = percentile(nets, 0.9);
    const pProfit = profits.reduce((a, b) => a + b, 0) / draws;
    const pCover = coverTickets.reduce((a, b) => a + b, 0) / draws;

    // Tornado sensitivity (deterministic ± shocks on base)
    const tornado = buildTornado(engine, model, baseOptions, base, preset, weatherCtx);

    const sentence = plainSentence({
      P10,
      P50,
      P90,
      pProfit,
      pCover,
      preset: preset.label,
      baseNet: base.K47,
      weatherCtx: weatherCtx,
    });

    return {
      draws,
      preset: presetName,
      presetLabel: preset.label,
      P10,
      P50,
      P90,
      pProfit,
      pCover,
      tornado,
      sentence,
      baseNet: base.K47,
      weather: weatherCtx,
      drawsDetail: drawsDetail,
    };
  }

  function scaleAncs(base, onsiteMult, sponsorFrac) {
    const out = {};
    (base.ancillaries || []).forEach((a) => {
      if (a.id === "sponsorship_dollars") {
        out[a.id] = a.amount * sponsorFrac * 3.2; // beta mean ~0.29 → ~0.93× baseline stretch
      } else {
        out[a.id] = a.amount * onsiteMult;
      }
    });
    return out;
  }

  function buildTornado(engine, model, baseOptions, base, preset, weatherCtx) {
    const drivers = [
      {
        name: "Attendance",
        low: () => {
          let n = Math.round(base.N * (1 + preset.attnLo));
          const lim = numLimit(baseOptions && baseOptions.limit_registrations);
          if (lim > 0) n = Math.min(n, lim);
          return engine.compute(model, { ...baseOptions, N: n }).K47;
        },
        high: () => {
          let n = Math.round(base.N * (1 + preset.attnHi));
          const lim = numLimit(baseOptions && baseOptions.limit_registrations);
          if (lim > 0) n = Math.min(n, lim);
          return engine.compute(model, { ...baseOptions, N: n }).K47;
        },
      },
      {
        name: "Avg ticket",
        low: () =>
          engine.compute(model, { ...baseOptions, ticket: base.ticket * 0.92 }).K47,
        high: () =>
          engine.compute(model, { ...baseOptions, ticket: base.ticket * 1.08 }).K47,
      },
      {
        name: "Talent cost",
        low: () =>
          engine.compute(model, {
            ...baseOptions,
            wizard: { ...(baseOptions.wizard || {}), musicFocus: "no" },
          }).K47,
        high: () =>
          engine.compute(model, {
            ...baseOptions,
            wizard: { ...(baseOptions.wizard || {}), musicFocus: "yes" },
          }).K47,
      },
      {
        name: "Camp mix",
        low: () =>
          engine.compute(model, {
            ...baseOptions,
            p_camp: Math.max(0.05, base.p_camp - 0.15),
          }).K47,
        high: () =>
          engine.compute(model, {
            ...baseOptions,
            p_camp: Math.min(0.99, base.p_camp + 0.1),
          }).K47,
      },
      {
        name: "On-site / ancillaries",
        low: () => {
          const o = {};
          base.ancillaries.forEach((a) => (o[a.id] = a.amount * 0.7));
          return engine.compute(model, {
            ...baseOptions,
            ancillaryOverrides: o,
            scaleAncillaries: false,
          }).K47;
        },
        high: () => {
          const o = {};
          base.ancillaries.forEach((a) => (o[a.id] = a.amount * 1.3));
          return engine.compute(model, {
            ...baseOptions,
            ancillaryOverrides: o,
            scaleAncillaries: false,
          }).K47;
        },
      },
    ];

    // Weather (climatology) tornado bar when outdoor/hybrid + rain_index
    if (weatherCtx && weatherCtx.weatherImpact > 0 && weatherCtx.rainIndex != null) {
      drivers.push({
        name: "Weather (climatology)",
        low: () =>
          applyWeatherTornado(engine, model, baseOptions, base, weatherCtx, "dry").K47,
        high: () =>
          applyWeatherTornado(engine, model, baseOptions, base, weatherCtx, "wet").K47,
      });
    }

    return drivers
      .map((d) => {
        const lo = d.low();
        const hi = d.high();
        return {
          name: d.name,
          low: lo,
          high: hi,
          swing: Math.abs(hi - lo),
        };
      })
      .sort((a, b) => b.swing - a.swing);
  }

  function plainSentence(s) {
    const fmt = (n) =>
      (n < 0 ? "-" : "") +
      "$" +
      Math.abs(Math.round(n)).toLocaleString("en-US");
    const pct = (p) => Math.round(p * 100) + "%";
    let out =
      "Under the " +
      s.preset +
      " attendance band, median full profit (K47) is " +
      fmt(s.P50) +
      " (P10 " +
      fmt(s.P10) +
      " · P90 " +
      fmt(s.P90) +
      "), with " +
      pct(s.pProfit) +
      " of draws profitable and " +
      pct(s.pCover) +
      " where ticket revenue covers opex.";
    const wx = s.weatherCtx;
    if (wx && wx.weatherImpact > 0 && wx.state && wx.month) {
      const monthNames = [
        "",
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];
      const monthLabel = monthNames[wx.month] || String(wx.month);
      out +=
        " Weather driver uses climatology for " +
        wx.state +
        " in " +
        monthLabel +
        ", not a live forecast.";
    }
    return out;
  }

  function resolveWeatherContext(baseOptions) {
    baseOptions = baseOptions || {};
    const sw = baseOptions.safetyWeather || baseOptions.safety_weather || {};
    const profile = baseOptions.profile || {};
    const venue =
      sw.venue_mode ||
      profile.venue_mode ||
      (baseOptions.wizard && baseOptions.wizard.venue_mode) ||
      "outdoor";
    let weatherImpact = 0;
    const mode = String(venue).toLowerCase();
    if (mode === "outdoor") weatherImpact = 1;
    else if (mode === "hybrid") weatherImpact = 0.5; // ASSUMPTION
    else weatherImpact = 0;

    const state = (sw.state || profile.state || baseOptions.state || "").toUpperCase();
    const city = sw.city || profile.city || baseOptions.city || "";
    let month = sw.month || profile.month || baseOptions.month || null;
    if (!month) {
      const dateStr =
        sw.start_date ||
        profile.start_date ||
        baseOptions.start_date ||
        null;
      if (dateStr) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) month = d.getUTCMonth() + 1;
      }
    }
    month = month != null ? Number(month) : null;

    let rainIndex = null;
    let rainLookup = null;
    if (
      weatherImpact > 0 &&
      typeof global.SafetyWeather !== "undefined" &&
      global.SafetyWeather &&
      typeof global.SafetyWeather.lookupRainIndex === "function"
    ) {
      rainLookup = global.SafetyWeather.lookupRainIndex({
        state: state,
        city: city,
        month: month,
      });
      if (rainLookup && rainLookup.index != null) rainIndex = rainLookup.index;
    }

    return {
      venue_mode: mode,
      weatherImpact: weatherImpact,
      state: state || null,
      city: city || null,
      month: month,
      rainIndex: rainIndex,
      rainLookup: rainLookup,
    };
  }

  /**
   * Weather shocks from climatology rain_index (1–10).
   * Higher rain → attendance down (camping harder), costs up, on-site F&B/merch down.
   */
  function weatherShocks(rng, rainIndex, campMix, wImpact) {
    const r = Math.max(1, Math.min(10, Number(rainIndex) || 5));
    // Center at 5: wet pulls attn down more for campers
    const wetness = ((r - 5) / 5) * wImpact; // -1..+1 scaled by venue impact
    // Stochastic around climatology bias
    const noise = (rng() - 0.5) * 0.08 * wImpact;
    const campPenalty = 0.12 * Math.max(0, wetness) * (0.5 + campMix); // camping harder
    const dayPenalty = 0.06 * Math.max(0, wetness);
    const attnMult = Math.max(0.55, 1 - campPenalty - dayPenalty + noise);
    const costMult = Math.max(0.9, 1 + 0.14 * Math.max(0, wetness) + Math.abs(noise));
    const onsiteMult = Math.max(0.5, 1 - 0.18 * Math.max(0, wetness) + noise * 0.5);
    // Camp mix softens when wet (camping harder)
    const campMixAdj = Math.min(
      0.99,
      Math.max(0.05, campMix * (1 - 0.15 * Math.max(0, wetness)))
    );
    return {
      attnMult: attnMult,
      costMult: costMult,
      onsiteMult: onsiteMult,
      campMix: campMixAdj,
    };
  }

  function applyWeatherTornado(engine, model, baseOptions, base, weatherCtx, side) {
    const rain = weatherCtx.rainIndex;
    const wImpact = weatherCtx.weatherImpact;
    // dry: treat as rain_index 2; wet: rain_index 9
    const fakeRain = side === "dry" ? 2 : 9;
    const campMix = base.p_camp;
    // Deterministic mid-rng substitute via fixed shocks (no rng)
    const wetness = ((fakeRain - 5) / 5) * wImpact;
    const campPenalty = 0.12 * Math.max(0, wetness) * (0.5 + campMix);
    const dayPenalty = 0.06 * Math.max(0, wetness);
    const attnMult = Math.max(0.55, 1 - campPenalty - dayPenalty);
    const costMult = Math.max(0.9, 1 + 0.14 * Math.max(0, wetness));
    const onsiteMult = Math.max(0.5, 1 - 0.18 * Math.max(0, wetness));
    const campAdj = Math.min(
      0.99,
      Math.max(0.05, campMix * (1 - 0.15 * Math.max(0, wetness)))
    );
    const N = Math.max(1, Math.round(base.N * attnMult));
    const o = {};
    (base.ancillaries || []).forEach(function (a) {
      o[a.id] = a.amount * onsiteMult;
    });
    const r = engine.compute(model, {
      ...baseOptions,
      N: N,
      p_camp: campAdj,
      ancillaryOverrides: o,
      scaleAncillaries: false,
    });
    const prodShock = r.departments.production * (costMult - 1);
    const siteShock = r.departments.site * (costMult - 1);
    const safetyShock = (r.safety_weather_subtotal || 0) * (costMult - 1);
    return {
      K47: r.K47 - prodShock - siteShock - safetyShock,
    };
  }

  /**
   * Pick draw nearest to P10 / P50 / P90 net from a run() result.
   * P10 = harder day; P90 = softer. Does not re-roll.
   */
  function pickRepresentativeDraw(result, band) {
    band = band || "P50";
    if (!result || !Array.isArray(result.drawsDetail) || !result.drawsDetail.length) {
      return {
        net: result ? result[band] || result.P50 : 0,
        baseNet: result ? result.baseNet : 0,
        N: 0,
        baseN: 0,
        shocks: {},
        band: band,
      };
    }
    const target =
      band === "P10" ? result.P10 : band === "P90" ? result.P90 : result.P50;
    let best = result.drawsDetail[0];
    let bestDist = Math.abs(best.net - target);
    for (let i = 1; i < result.drawsDetail.length; i++) {
      const d = result.drawsDetail[i];
      const dist = Math.abs(d.net - target);
      if (dist < bestDist) {
        best = d;
        bestDist = dist;
      }
    }
    return Object.assign({}, best, { band: band, targetNet: target });
  }

  function summarizeShocks(draw) {
    const s = (draw && draw.shocks) || {};
    return {
      attendance: s.attnMult,
      ticket: s.ticketMult,
      talent: s.talentMult,
      production: s.prodMult,
      onsite: s.onsiteMult,
      campMixDelta: s.campMixDelta,
      weatherCost: s.weatherCost,
      weatherAttn: s.weatherAttn,
    };
  }

  global.MonteCarlo = {
    run,
    PRESETS,
    pickRepresentativeDraw,
    summarizeShocks,
    percentile,
  };
})(typeof window !== "undefined" ? window : global);
