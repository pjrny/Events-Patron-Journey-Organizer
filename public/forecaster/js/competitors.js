/**
 * Competitor panel — uses CompetitorScore.topN on festivals.json (fetch).
 * Never invents festivals.
 */
(function (global) {
  "use strict";

  function reasonLabel(r) {
    const map = {
      type_match: "same type",
      subtype_match: "same subtype",
      same_state: "same state",
      same_city: "same city",
      date_overlap_or_same_month: "date overlap / same month",
      size_band: "size band 0.5×–2×",
    };
    return map[r] || r;
  }

  /**
   * @param {object} self - UI profile
   * @param {array} festivals
   */
  function match(self, festivals) {
    const list = Array.isArray(festivals) ? festivals : [];
    if (!list.length) {
      return {
        matches: [],
        empty: true,
        message:
          "No competitor festivals loaded yet. Serve the app statically and ensure festivals.json is present (26,780 events).",
      };
    }

    const input = {
      category: self.category || self.type,
      type: self.type || self.category,
      subcategory: self.subcategory || self.subtype,
      subtype: self.subtype || self.subcategory,
      state: self.state,
      city: self.city,
      start: self.start || self.start_date,
      end: self.end || self.end_date,
      start_date: self.start_date || self.start,
      end_date: self.end_date || self.end,
      attendance: self.attendance || self.N || self.size,
      N: self.N || self.attendance,
      nowYear: new Date().getUTCFullYear(),
    };

    const scorer = global.CompetitorScore;
    if (!scorer || typeof scorer.topN !== "function") {
      return {
        matches: [],
        empty: false,
        message: "CompetitorScore not loaded.",
      };
    }

    // Score all; take top 8 with score > 0
    const ranked = scorer.topN(input, list, 8).filter(function (x) {
      return x.score > 0;
    });

    const matches = ranked.map(function (m) {
      return {
        festival: m.fest || m.festival,
        score: m.score,
        reasons: (m.reasons || [])
          .filter(function (r) {
            return r !== "directory match, dates may be stale";
          })
          .map(reasonLabel),
        stale: !!m.stale,
        staleLabel: m.staleLabel || (m.stale ? "directory match, dates may be stale" : null),
      };
    });

    return {
      matches: matches,
      empty: false,
      total: list.length,
      message:
        matches.length === 0
          ? "No scored matches among " + list.length.toLocaleString() + " festivals."
          : "Top " +
            matches.length +
            " of " +
            list.length.toLocaleString() +
            " directory festivals.",
    };
  }

  global.Competitors = { match };
})(typeof window !== "undefined" ? window : global);
