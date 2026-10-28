/**
 * Safety / Weather optional add-on — OUTSIDE Master Budget G3.
 * rain_index: climatology ranks only (not NOAA / not live forecast).
 */
(function (global) {
  "use strict";

  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function ceil(n) {
    return Math.ceil(n);
  }

  function defaultModel() {
    const baked =
      (typeof global !== "undefined" && global.SAFETY_WEATHER_MODEL) ||
      (typeof window !== "undefined" && window.SAFETY_WEATHER_MODEL) ||
      null;
    return baked;
  }

  function defaultRainIndex() {
    const baked =
      (typeof global !== "undefined" && global.RAIN_INDEX) ||
      (typeof window !== "undefined" && window.RAIN_INDEX) ||
      null;
    return baked;
  }

  function normCity(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\./g, "");
  }

  /**
   * lookupRainIndex({ state, city, month })
   * → { index, source, state, city, month, ASSUMPTION } or null if missing
   */
  function lookupRainIndex(opts) {
    opts = opts || {};
    const data = opts.rainIndex || defaultRainIndex();
    if (!data || !data.states) return null;

    let month = num(opts.month, 0);
    if (!month && opts.date) {
      const d = new Date(opts.date);
      if (!isNaN(d.getTime())) month = d.getUTCMonth() + 1;
    }
    month = Math.round(month);
    if (month < 1 || month > 12) return null;

    const stateRaw = String(opts.state || "")
      .trim()
      .toUpperCase();
    const cityRaw = String(opts.city || "").trim();
    const cityKey = normCity(cityRaw);
    const monthKey = String(month);

    const ASSUMPTION =
      (data && data.ASSUMPTION) ||
      "Approximate climatology ranks for planning, not NOAA.";

    // City overrides first (exact key or aliases)
    const overrides = data.city_overrides || {};
    let cityHit = null;
    Object.keys(overrides).forEach(function (name) {
      if (cityHit) return;
      const entry = overrides[name];
      const aliases = [name].concat(entry.aliases || []);
      for (let i = 0; i < aliases.length; i++) {
        if (normCity(aliases[i]) === cityKey && cityKey) {
          cityHit = { name: name, entry: entry };
          break;
        }
      }
    });

    if (cityHit && cityHit.entry.months && cityHit.entry.months[monthKey] != null) {
      return {
        index: num(cityHit.entry.months[monthKey], null),
        source: "city_override:" + cityHit.name,
        state: (cityHit.entry.state || stateRaw || "").toUpperCase(),
        city: cityHit.name,
        month: month,
        ASSUMPTION: ASSUMPTION,
      };
    }

    if (!stateRaw || !data.states[stateRaw]) {
      return {
        index: null,
        source: "missing",
        state: stateRaw,
        city: cityRaw || null,
        month: month,
        ASSUMPTION: ASSUMPTION,
      };
    }

    const idx = data.states[stateRaw][monthKey];
    if (idx == null) {
      return {
        index: null,
        source: "missing_month",
        state: stateRaw,
        city: cityRaw || null,
        month: month,
        ASSUMPTION: ASSUMPTION,
      };
    }

    return {
      index: num(idx, null),
      source: "state:" + stateRaw,
      state: stateRaw,
      city: cityRaw || null,
      month: month,
      ASSUMPTION: ASSUMPTION,
    };
  }

  function weatherImpact(venueMode, model) {
    const table =
      (model && model.weather_impact) || {
        outdoor: 1,
        hybrid: 0.5,
        indoor: 0,
      };
    const mode = String(venueMode || "outdoor").toLowerCase();
    if (mode === "indoor") return num(table.indoor, 0);
    if (mode === "hybrid") return num(table.hybrid, 0.5);
    return num(table.outdoor, 1);
  }

  /**
   * computeSafetyWeatherEstimate(profile)
   * profile: {
   *   enabled, N, peak_occupancy, show_days, load_in_days, camping,
   *   venue_mode, weather_service_budget, cancellation_reserve_pct,
   *   master_opex (G3), qtyOverrides, model
   * }
   */
  function computeSafetyWeatherEstimate(profile) {
    profile = profile || {};
    const enabled = !!profile.enabled;
    const model = profile.model || defaultModel();
    const catalog = (model && model.catalog) || [];
    const defs = (model && model.defaults) || {};

    const empty = {
      enabled: false,
      lines: [],
      subtotal: 0,
      weather_impact: 0,
      venue_mode: profile.venue_mode || defs.venue_mode || "outdoor",
      bucket_label: (model && model.label) || "Safety / Weather (optional)",
      disclaimer:
        (model && model.disclaimer) ||
        "Planning estimate only — not a legal/safety plan.",
      assumption_note: null,
      checklist: null,
    };

    if (!enabled) return empty;

    const N = Math.max(0, num(profile.N, 0));
    const peak = Math.max(
      0,
      num(
        profile.peak_occupancy != null ? profile.peak_occupancy : null,
        N
      )
    );
    const show_days = Math.max(0, num(profile.show_days, defs.show_days != null ? defs.show_days : 3));
    const load_in_days = Math.max(
      0,
      num(profile.load_in_days, defs.load_in_days != null ? defs.load_in_days : 2)
    );
    const camping = !!(
      profile.camping === true ||
      profile.camping === "on" ||
      profile.camping === "yes"
    );
    const venue_mode = String(
      profile.venue_mode || defs.venue_mode || "outdoor"
    ).toLowerCase();
    const wImpact = weatherImpact(venue_mode, model);
    const masterOpex = Math.max(0, num(profile.master_opex, 0));
    const cancelPct = num(
      profile.cancellation_reserve_pct,
      defs.cancellation_reserve_pct != null ? defs.cancellation_reserve_pct : 5
    );
    const weatherBudget = num(
      profile.weather_service_budget,
      defs.weather_service_budget != null ? defs.weather_service_budget : 2500
    );

    const overrides = profile.qtyOverrides || {};

    function overrideQty(id, fallback) {
      if (!Object.prototype.hasOwnProperty.call(overrides, id)) return fallback;
      if (overrides[id] === "" || overrides[id] == null) return fallback;
      const v = Number(overrides[id]);
      if (Number.isFinite(v) && v >= 0) return v;
      return fallback;
    }

    const blocks100 = Math.max(1, ceil(peak / 100));
    const overnightNights = camping ? Math.max(0, show_days - 1) : 0;

    const defaultQtys = {
      medical_first_aid: show_days + load_in_days,
      security_per_100: blocks100 * show_days,
      security_overnight_camp: camping ? blocks100 * overnightNights : 0,
      fire_ems_standby: show_days,
      radios_command_post: 1,
      temp_structure_pe: 1,
      weather_monitoring: 1,
      ground_protection: 1,
      delay_labor_bank: 1,
      cancellation_reserve: 1,
    };

    const lines = [];
    catalog.forEach(function (item) {
      const id = item.id;
      const cat = item.category || "safety";
      let unitPrice = num(item.unit_price, 0);
      let qty = overrideQty(id, defaultQtys[id] != null ? defaultQtys[id] : 0);
      let note = item.ASSUMPTION || "";

      if (id === "weather_monitoring") {
        // Flat $ from weather_service_budget (qty still 0/1 overridable)
        unitPrice = weatherBudget;
      }

      if (id === "cancellation_reserve") {
        unitPrice = Math.round(masterOpex * (cancelPct / 100) * 100) / 100;
        qty = overrideQty(id, 1);
        note =
          "ASSUMPTION: " +
          cancelPct +
          "% of Master G3 ($" +
          masterOpex.toFixed(2) +
          ")";
      }

      let extended = Math.round(unitPrice * qty * 100) / 100;

      // Weather-category lines scaled by venue weather impact
      if (cat === "weather") {
        extended = Math.round(extended * wImpact * 100) / 100;
        note =
          (note ? note + " · " : "") +
          "weather_impact=" +
          wImpact +
          " (" +
          venue_mode +
          ")";
      }

      // Zero overnight line when not camping and user did not force qty
      if (id === "security_overnight_camp" && !camping && !Object.prototype.hasOwnProperty.call(overrides, id)) {
        qty = 0;
        extended = 0;
      }

      lines.push({
        id: id,
        label: item.label,
        unit_price: unitPrice,
        qty: qty,
        unit: item.unit,
        extended: extended,
        category: cat,
        qty_rule: item.qty_rule || "",
        note: note,
      });
    });

    const subtotal =
      Math.round(
        lines.reduce(function (s, l) {
          return s + l.extended;
        }, 0) * 100
      ) / 100;

    const checklist = {
      ahj_fire_permit_status:
        profile.ahj_fire_permit_status || defs.ahj_fire_permit_status || "unknown",
      lightning_stand_down_miles: num(
        profile.lightning_stand_down_miles,
        defs.lightning_stand_down_miles != null ? defs.lightning_stand_down_miles : 8
      ),
      wind_hold_mph: num(
        profile.wind_hold_mph,
        defs.wind_hold_mph != null ? defs.wind_hold_mph : 35
      ),
      heat_index_cold_trigger:
        profile.heat_index_cold_trigger != null
          ? profile.heat_index_cold_trigger
          : defs.heat_index_cold_trigger || "",
      nearest_hospital_minutes: num(
        profile.nearest_hospital_minutes,
        defs.nearest_hospital_minutes != null ? defs.nearest_hospital_minutes : 25
      ),
      note: "Checklist only — does not change dollars.",
    };

    return {
      enabled: true,
      lines: lines,
      subtotal: subtotal,
      weather_impact: wImpact,
      venue_mode: venue_mode,
      peak_occupancy: peak,
      show_days: show_days,
      load_in_days: load_in_days,
      camping: camping,
      cancellation_reserve_pct: cancelPct,
      weather_service_budget: weatherBudget,
      bucket_label: (model && model.label) || "Safety / Weather (optional)",
      disclaimer:
        (model && model.disclaimer) ||
        "Planning estimate only — not a legal/safety plan.",
      assumption_note:
        "ASSUMPTION: default qtys from heuristics (medical days=show+load-in, security=ceil(peak/100)×days, overnight if camping, fire=show days, flats as labeled). Weather lines × " +
        wImpact +
        " for " +
        venue_mode +
        ". Edit any qty.",
      checklist: checklist,
      source_note:
        (model && model.ASSUMPTION) ||
        "Optional adders outside Master Budget G3.",
    };
  }

  global.SafetyWeather = {
    computeSafetyWeatherEstimate: computeSafetyWeatherEstimate,
    lookupRainIndex: lookupRainIndex,
    weatherImpact: weatherImpact,
    defaultModel: defaultModel,
    defaultRainIndex: defaultRainIndex,
  };
})(typeof window !== "undefined" ? window : global);
