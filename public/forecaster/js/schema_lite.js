/**
 * Minimal zero-dependency JSON Schema (2020-12 subset) validator, enough for
 * docs/event-draft.v1.schema.json: type (incl. arrays/integer/null), const,
 * required, properties, additionalProperties:false, items, min/maxLength,
 * pattern (unicode), minimum/maximum, maxItems, uniqueItems, not, anyOf.
 * validate(schema, value) -> string[] errors ("path: reason").
 */
(function (global) {
  "use strict";
  function typeOf(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
    return typeof v;
  }
  function typeOk(t, v) {
    var a = typeOf(v);
    return t === a || (t === "number" && a === "integer");
  }
  function walk(s, v, path, errs) {
    if (!s || typeof s !== "object") return;
    if (s.type) {
      var ts = Array.isArray(s.type) ? s.type : [s.type];
      if (!ts.some(function (t) { return typeOk(t, v); })) { errs.push(path + ": expected " + ts.join("|")); return; }
    }
    if ("const" in s && JSON.stringify(s.const) !== JSON.stringify(v)) errs.push(path + ": must equal " + JSON.stringify(s.const));
    if (typeof v === "string") {
      var len = Array.from(v).length;
      if (s.minLength != null && len < s.minLength) errs.push(path + ": shorter than " + s.minLength);
      if (s.maxLength != null && len > s.maxLength) errs.push(path + ": longer than " + s.maxLength);
      if (s.pattern && !new RegExp(s.pattern, "u").test(v)) errs.push(path + ": does not match " + s.pattern);
    }
    if (typeof v === "number") {
      if (s.minimum != null && v < s.minimum) errs.push(path + ": < " + s.minimum);
      if (s.maximum != null && v > s.maximum) errs.push(path + ": > " + s.maximum);
    }
    if (Array.isArray(v)) {
      if (s.maxItems != null && v.length > s.maxItems) errs.push(path + ": more than " + s.maxItems + " items");
      if (s.uniqueItems) {
        var seen = {};
        v.forEach(function (x, i) { var k = JSON.stringify(x); if (seen[k]) errs.push(path + "[" + i + "]: duplicate"); seen[k] = 1; });
      }
      if (s.items) v.forEach(function (x, i) { walk(s.items, x, path + "[" + i + "]", errs); });
    }
    if (typeOf(v) === "object") {
      (s.required || []).forEach(function (k) { if (!(k in v)) errs.push(path + "." + k + ": required"); });
      var props = s.properties || {};
      Object.keys(v).forEach(function (k) {
        if (props[k]) walk(props[k], v[k], path + "." + k, errs);
        else if (s.additionalProperties === false) errs.push(path + "." + k + ": not allowed");
      });
    }
    if (s.anyOf) {
      var any = s.anyOf.some(function (sub) { var e = []; walk(sub, v, path, e); return e.length === 0; });
      if (!any) errs.push(path + ": matches none of anyOf");
    }
    if (s.not) {
      var e2 = []; walk(s.not, v, path, e2);
      if (e2.length === 0) errs.push(path + ": matches forbidden 'not' schema");
    }
  }
  function validate(schema, value) { var errs = []; walk(schema, value, "$", errs); return errs; }
  var api = { validate: validate };
  global.SchemaLite = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
