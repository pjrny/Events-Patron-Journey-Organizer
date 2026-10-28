/**
 * Competitor scorer — browser build (mirrors /competitor_score.js).
 * Weights: 3*type + 2*subtype + 3*same_state + 2*same_city
 *   + 2*date_overlap_or_same_month + 1*size_band(0.5x–2x)
 * Never invents festivals.
 */
(function (global) {
  "use strict";

  function norm(s) {
    return (s == null ? "" : String(s)).trim().toLowerCase();
  }

  function parseYMD(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return { y: +m[1], mo: +m[2], d: +m[3], t: Date.UTC(+m[1], +m[2] - 1, +m[3]) };
  }

  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    if (aStart == null || bStart == null) return false;
    const as = aStart.t;
    const ae = (aEnd || aStart).t;
    const bs = bStart.t;
    const be = (bEnd || bStart).t;
    return as <= be && bs <= ae;
  }

  function sameMonth(aStart, bStart) {
    if (!aStart || !bStart) return false;
    return aStart.y === bStart.y && aStart.mo === bStart.mo;
  }

  /** Month-of-year match ignoring year (directory often historical). */
  function sameMonthOfYear(aStart, bStart) {
    if (!aStart || !bStart) return false;
    return aStart.mo === bStart.mo;
  }

  function sizeBandMatch(inputAtt, festAtt) {
    if (inputAtt == null || festAtt == null) return false;
    const a = Number(inputAtt);
    const b = Number(festAtt);
    if (!(a > 0) || !(b > 0)) return false;
    const ratio = b / a;
    return ratio >= 0.5 && ratio <= 2.0;
  }

  function festYear(fest) {
    const p = parseYMD(fest.start || fest.end);
    return p ? p.y : null;
  }

  function isHistoricalYear(y, nowYear) {
    if (y == null) return false;
    return y < nowYear;
  }

  function scoreFestival(input, fest) {
    const reasons = [];
    let score = 0;

    const inType = norm(input.category ?? input.type);
    const festType = norm(fest.category ?? fest.type);
    if (inType && festType && inType === festType) {
      score += 3;
      reasons.push("type_match");
    }

    const inSub = norm(input.subcategory ?? input.subtype);
    const festSub = norm(fest.subcategory ?? fest.subtype);
    if (inSub && festSub && inSub === festSub) {
      score += 2;
      reasons.push("subtype_match");
    }

    const inState = norm(input.state).toUpperCase();
    const festState = norm(fest.state).toUpperCase();
    if (inState && festState && inState === festState) {
      score += 3;
      reasons.push("same_state");
    }

    const inCity = norm(input.city);
    const festCity = norm(fest.city);
    if (inCity && festCity && inCity === festCity) {
      score += 2;
      reasons.push("same_city");
    }

    const iStart = parseYMD(input.start ?? input.start_date);
    const iEnd = parseYMD(input.end ?? input.end_date);
    const fStart = parseYMD(fest.start);
    const fEnd = parseYMD(fest.end);
    // Exact calendar overlap/same month, OR same month-of-year for directory comps
    if (
      rangesOverlap(iStart, iEnd, fStart, fEnd) ||
      sameMonth(iStart, fStart) ||
      (iStart && fStart && sameMonthOfYear(iStart, fStart))
    ) {
      score += 2;
      reasons.push("date_overlap_or_same_month");
    }

    if (sizeBandMatch(input.attendance ?? input.size ?? input.N, fest.attendance)) {
      score += 1;
      reasons.push("size_band");
    }

    return { score, reasons };
  }

  function topN(input, festivals, n) {
    n = n == null ? 8 : n;
    const nowYear = (input && input.nowYear) || new Date().getUTCFullYear();
    const scored = (festivals || []).map(function (fest) {
      const r = scoreFestival(input, fest);
      const y = festYear(fest);
      const stale = isHistoricalYear(y, nowYear);
      const reasons = r.reasons.slice();
      if (stale) reasons.push("directory match, dates may be stale");
      return {
        fest: fest,
        festival: fest,
        score: r.score,
        reasons: reasons,
        stale: stale,
        staleLabel: stale ? "directory match, dates may be stale" : null,
      };
    });
    scored.sort(function (a, b) {
      return b.score - a.score || norm(a.fest.name).localeCompare(norm(b.fest.name));
    });
    return scored.slice(0, n);
  }

  const api = { scoreFestival, topN, festYear, isHistoricalYear };
  global.CompetitorScore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : global);
