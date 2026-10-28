/**
 * Tiny competitor festival scorer sketch for Festival Forecaster.
 * Weights:
 *   3*type_match + 2*subtype_match + 3*same_state + 2*same_city
 *   + 2*date_overlap_or_same_month + 1*size_band(0.5x–2x attendance)
 */

function norm(s) {
  return (s == null ? '' : String(s)).trim().toLowerCase();
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

function sizeBandMatch(inputAtt, festAtt) {
  if (inputAtt == null || festAtt == null) return false;
  const a = Number(inputAtt);
  const b = Number(festAtt);
  if (!(a > 0) || !(b > 0)) return false;
  const ratio = b / a;
  return ratio >= 0.5 && ratio <= 2.0;
}

/**
 * @param {object} input - { category/type, subcategory/subtype, state, city, start, end, attendance }
 * @param {object} fest  - festival from festivals.json
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreFestival(input, fest) {
  const reasons = [];
  let score = 0;

  const inType = norm(input.category ?? input.type);
  const festType = norm(fest.category);
  if (inType && festType && inType === festType) {
    score += 3;
    reasons.push('type_match');
  }

  const inSub = norm(input.subcategory ?? input.subtype);
  const festSub = norm(fest.subcategory);
  if (inSub && festSub && inSub === festSub) {
    score += 2;
    reasons.push('subtype_match');
  }

  const inState = norm(input.state).toUpperCase();
  const festState = norm(fest.state).toUpperCase();
  if (inState && festState && inState === festState) {
    score += 3;
    reasons.push('same_state');
  }

  const inCity = norm(input.city);
  const festCity = norm(fest.city);
  if (inCity && festCity && inCity === festCity) {
    score += 2;
    reasons.push('same_city');
  }

  const iStart = parseYMD(input.start);
  const iEnd = parseYMD(input.end);
  const fStart = parseYMD(fest.start);
  const fEnd = parseYMD(fest.end);
  if (rangesOverlap(iStart, iEnd, fStart, fEnd) || sameMonth(iStart, fStart)) {
    score += 2;
    reasons.push('date_overlap_or_same_month');
    reasons.push('directory match, dates may be stale.');
  }

  if (sizeBandMatch(input.attendance ?? input.size, fest.attendance)) {
    score += 1;
    reasons.push('size_band');
  }

  return { score, reasons };
}

/**
 * @param {object} input
 * @param {object[]} festivals
 * @param {number} [n=8]
 * @returns {{ fest: object, score: number, reasons: string[] }[]}
 */
function topN(input, festivals, n = 8) {
  const scored = (festivals || []).map((fest) => {
    const { score, reasons } = scoreFestival(input, fest);
    return { fest, score, reasons };
  });
  scored.sort((a, b) => b.score - a.score || norm(a.fest.name).localeCompare(norm(b.fest.name)));
  return scored.slice(0, n);
}

module.exports = { scoreFestival, topN };
