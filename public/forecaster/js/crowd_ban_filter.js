/**
 * Shared crowd/safety feed ban filter (pure). Used by the browser bank AND the
 * organizer Worker before any generated line is shown. No I/O, no deps.
 *
 *   CrowdBanFilter.check(line, { realNames: [...] }) -> { ok, reasons[] }
 *   CrowdBanFilter.isAllowed(line, opts) -> boolean
 *   CrowdBanFilter.filterLines(lines, opts, fallbackBank) -> string[]
 *
 * Categories: real_name, minors_sexual, sexual, drug_howto, assault_od,
 * doxxing (phone/email/street address/SSN/handles), slur.
 */
(function (global) {
  "use strict";

  var RULES = [
    { cat: "minors_sexual", re: /\b(minor|minors|underage|under[- ]?18|child|children|kid|kids|teen|teens|middle school|high school(er)?|schoolgirl|schoolboy|ptot|loli)\b[\s\S]{0,60}\b(sex|sexy|nude|naked|porn|hook ?up|grope|fondl\w*)\b/i },
    { cat: "minors_sexual", re: /\b(sex|sexy|nude|naked|porn|hook ?up|grope|fondl\w*)\b[\s\S]{0,60}\b(minor|minors|underage|under[- ]?18|child|kid|kids|teen|teens|schoolgirl|schoolboy|ptot|loli)\b/i },
    { cat: "sexual", re: /\b(porn|nudes?|blowjob|handjob|orgasm|genitals?|dick pic|sex act|having sex|f[u\*]cked (her|him))\b/i },
    { cat: "drug_howto", re: /\b(how to|where to|ways? to|tips? (for|on)|best way to)\b[\s\S]{0,40}\b(dose|cook|cut|snort|smuggle|sneak|hide|buy|score|cop|plug|parachute|boof)\b/i },
    { cat: "drug_howto", re: /\b(\d+\s?(mg|g|grams?|tabs?|caps?|hits?)\b[\s\S]{0,20}\b(molly|mdma|ecstasy|ket(amine)?|acid|lsd|shrooms|coke|cocaine|ghb|fent(anyl)?|xanax)|(molly|mdma|ecstasy|ket(amine)?|acid|lsd|shrooms|coke|cocaine|ghb|fent(anyl)?)[\s\S]{0,20}\b\d+\s?(mg|g|grams?|tabs?|caps?|hits?))\b/i },
    { cat: "drug_howto", re: /\b(sneak|smuggl\w*|hide|hid)\b[\s\S]{0,30}\b(drugs?|molly|pills?|ket|coke|acid|tabs)\b[\s\S]{0,30}\b(in|past|through|into)\b/i },
    { cat: "assault_od", re: /\b(rape[ds]?|raping|sexual(ly)? assault\w*|drugged (her|him|my|a)|roofie\w*|spik(e|ed|ing) (her|his|a|my) drink)\b/i },
    { cat: "assault_od", re: /\b(hope|wish|want|deserve)\w*\b[\s\S]{0,30}\b(ods?|o\.d\.?s?|overdos\w*|die|dies|dying|dead|gets? (hurt|stabbed|shot|trampled|crushed))\b/i },
    { cat: "assault_od", re: /\b(beat (him|her|them) up|stab(bed)? (him|her|someone)|punch(ed)? (a|that) (girl|woman|guy))\b/i },
    { cat: "doxxing", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
    { cat: "doxxing", re: /(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/ },
    { cat: "doxxing", re: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/ },
    { cat: "doxxing", re: /\b\d{1,6}\s+([A-Z][a-z0-9]+\s){0,3}(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pl|place|hwy|highway)\b\.?/i },
    { cat: "doxxing", re: /\b(lives (at|on)|home address|her address|his address|license plate|plate number)\b/i },
    { cat: "doxxing", re: /(^|\s)@[A-Za-z0-9_]{3,}\b(?<!@anon\d{4})/ },
    { cat: "real_name", re: /\b(my name is|her name is|his name is|named) [A-Z][a-z]+ [A-Z][a-z]+\b/ },
  ];

  // Slurs kept as obfuscated stems (matched case-insensitively, word-boundary).
  var SLUR_STEMS = ["n[i1]gg(a|er|uh)s?", "f[a@]gg?(ot|ots|y)?", "r[e3]t[a@]rd(s|ed)?", "tr[a@]nn(y|ies)", "sp[i1]cs?", "ch[i1]nks?", "k[i1]kes?", "w[e3]tb[a@]cks?", "d[y1]kes?", "g[o0]oks?", "b[e3][a@]ners?", "c[o0]ons?", "sh[e3]m[a@]les?"];
  var SLUR_RE = new RegExp("\\b(" + SLUR_STEMS.join("|") + ")\\b", "i");

  function check(line, opts) {
    opts = opts || {};
    var reasons = [];
    if (line == null || typeof line !== "string" || !line.trim()) return { ok: false, reasons: ["empty"] };
    var s = line.trim();
    if (opts.maxLength && s.length > opts.maxLength) reasons.push("too_long");
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i].re.test(s) && reasons.indexOf(RULES[i].cat) < 0) reasons.push(RULES[i].cat);
    }
    if (SLUR_RE.test(s)) reasons.push("slur");
    var names = opts.realNames || [];
    for (var j = 0; j < names.length; j++) {
      var n = String(names[j] || "").trim();
      if (n.length < 3) continue;
      var esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp("\\b" + esc + "\\b", "i").test(s)) { reasons.push("real_name"); break; }
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  function isAllowed(line, opts) { return check(line, opts).ok; }

  /** Filter generated lines; if fewer than opts.min survive, top up from fallbackBank (also filtered). */
  function filterLines(lines, opts, fallbackBank) {
    opts = opts || {};
    var out = (lines || []).filter(function (l) { return isAllowed(l, opts); });
    var min = opts.min != null ? opts.min : 1;
    if (out.length < min && Array.isArray(fallbackBank)) {
      for (var i = 0; i < fallbackBank.length && out.length < min; i++) {
        var l = fallbackBank[i];
        if (isAllowed(l, opts) && out.indexOf(l) < 0) out.push(l);
      }
    }
    return out;
  }

  var api = { check: check, isAllowed: isAllowed, filterLines: filterLines, RULES: RULES };
  global.CrowdBanFilter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
