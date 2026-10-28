/**
 * event-draft.v1 export — simulator → organizer Worker contract.
 * Pure functions (browser global EventDraft + CommonJS export) so the
 * organizer Worker / node tests can reuse them.
 *
 * Odoo-bound: name, start, end, timezone, venue, capacity, tags, tickets, lineup.
 * D1-only: forecast.* (never sent to Odoo; Worker stores alongside the draft).
 *
 * Canonical contract: docs/event-draft.v1.schema.json (copied from
 * pjrny/Events-Patron-Journey-Organizer; see docs/event-draft.v1.schema.SOURCE.json).
 */
(function (global) {
  "use strict";

  var VERSION = "event-draft.v1";
  var ACT_ACTIONS = { set: 1, act: 1, first_set: 1, last_set: 1, headliner: 1, performance: 1 };
  var DEFAULT_START_TIME = "12:00";
  var DEFAULT_END_TIME = "23:00";
  var DEFAULT_SET_MINUTES = 60;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function str(v) { return v == null ? "" : String(v).trim(); }

  function isoLocal(date, time) {
    // date 'YYYY-MM-DD', time 'HH:mm' → 'YYYY-MM-DDTHH:mm' (no offset)
    var d = str(date), t = str(time) || "00:00";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
    var m = /^(\d{1,2}):(\d{2})/.exec(t);
    if (!m) return "";
    return d + "T" + pad(Number(m[1])) + ":" + m[2];
  }

  function addDays(date, n) {
    var p = str(date).split("-").map(Number);
    var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return dt.getUTCFullYear() + "-" + pad(dt.getUTCMonth() + 1) + "-" + pad(dt.getUTCDate());
  }

  function addMinutes(iso, mins) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(iso);
    if (!m) return "";
    var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] + mins));
    return dt.getUTCFullYear() + "-" + pad(dt.getUTCMonth() + 1) + "-" + pad(dt.getUTCDate()) +
      "T" + pad(dt.getUTCHours()) + ":" + pad(dt.getUTCMinutes());
  }

  // canonical tag rule: ^[\p{L}\p{N} &'/+.-]+$, 1–40 chars, unique, ≤15
  function cleanTags(list) {
    var out = [], seen = {};
    (list || []).forEach(function (t) {
      var v = str(t).replace(/[^\p{L}\p{N} &'\/+.\-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40).trim();
      var k = v.toLowerCase();
      if (v && !seen[k] && out.length < 15) { seen[k] = 1; out.push(v); }
    });
    return out;
  }

  function money(n) {
    var v = Number(n) || 0;
    return Math.round(v) === v ? String(v) : v.toFixed(2);
  }

  function capacityOf(p) {
    var lim = Number(p.limit_registrations);
    if (lim > 0) return Math.floor(lim);
    return Math.floor(Number(p.N) || 0);
  }

  function findVip(tiers) {
    if (!tiers || !tiers.enabled || !Array.isArray(tiers.rows)) return null;
    for (var i = 0; i < tiers.rows.length; i++) {
      var t = tiers.rows[i] || {};
      if (/\bvip\b/i.test(str(t.name)) && Number(t.price) > 0) return t;
    }
    return null;
  }

  // Labels produced by RosGate.generateSkeleton — never treated as act names.
  var PLACEHOLDER_RE = /^(first|last) set day \d+$|^(doors|peak attendance window)\b.*day \d+$|^(set|act|headliner|performance|first_set|last_set)$/i;

  function isPlaceholderName(s) {
    return !s || PLACEHOLDER_RE.test(s);
  }

  /** Only names the organizer typed; auto-generated slot labels → ''. */
  function actName(r) {
    var a = str(r.artist);
    if (a && !isPlaceholderName(a)) return a;
    if (r.generated === true) return "";
    var n = str(r.note);
    return isPlaceholderName(n) ? "" : n;
  }

  function isActRow(r) {
    if (!r) return false;
    if (str(r.kind).toLowerCase() === "act") return true;
    if (str(r.artist)) return true;
    return !!ACT_ACTIONS[str(r.action).toLowerCase()];
  }

  function buildLineup(ros, startDate) {
    if (!ros || !ros.confirmed || !Array.isArray(ros.rows)) return [];
    var acts = ros.rows.filter(isActRow).map(function (r) {
      var day = Number(r.day) || 1;
      var date = addDays(startDate, Math.max(0, day - 1));
      var start = isoLocal(date, r.time);
      var end = r.end_time ? isoLocal(date, r.end_time) : addMinutes(start, Number(r.duration_min) || DEFAULT_SET_MINUTES);
      return {
        name: actName(r),
        start: start,
        end: end,
        // canonical schema: lineup items allow only {name,start,end} (additionalProperties:false);
        // stage/area stays in the D1 forecast ROS, not the Odoo payload.
      };
    });
    return acts.filter(function (a) { return a.start; })
      .sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  }

  /**
   * state = {
   *   profile: { name, start_date, end_date, start_time, end_time, timezone,
   *              venue_name, street, city, state, zip, type, subtype, genre,
   *              camping, cashless, N, limit_registrations },
   *   ga_price, tiers:{enabled, rows}, ros:{confirmed, rows},
   *   mc:{P10,P50,P90,pProfit}, budget:{K2, departments}, ledger:[...]
   * }
   */
  function buildEventDraft(state) {
    state = state || {};
    var p = state.profile || {};
    var capacity = capacityOf(p);
    var tags = cleanTags([p.type, p.subtype, p.genre,
      p.camping ? "Camping" : "", p.cashless ? "Cashless " + str(p.cashless) : ""]);

    var tickets = [{ name: "GA – Pay at Door $" + money(state.ga_price), price: 0, max: capacity }];
    var vip = findVip(state.tiers);
    if (vip) {
      var vmax = Math.floor(Number(vip.max) > 0 ? Number(vip.max) : Number(vip.qty) || 0);
      var vt = { name: str(vip.name) + " – Pay at Door $" + money(vip.price), price: 0 };
      if (vmax >= 1) vt.max = vmax; // schema: integer ≥ 1 or omitted
      tickets.push(vt);
    }

    var mc = state.mc || null;
    var b = state.budget || {};
    var depts = {};
    Object.keys(b.departments || {}).forEach(function (k) {
      var v = b.departments[k];
      depts[k] = typeof v === "number" ? v : (v && v.total != null ? v.total : v);
    });

    return {
      version: VERSION,
      name: str(p.name),
      start: isoLocal(p.start_date, p.start_time || DEFAULT_START_TIME),
      end: isoLocal(p.end_date || p.start_date, p.end_time || DEFAULT_END_TIME),
      timezone: str(p.timezone) || "America/Chicago",
      venue: {
        name: str(p.venue_name), street: str(p.street), city: str(p.city),
        state: str(p.state), zip: str(p.zip),
      },
      capacity: capacity,
      tags: tags,
      tickets: tickets,
      lineup: buildLineup(state.ros, p.start_date),
      forecast: {
        _storage: "d1_only",
        _note: "Never sent to Odoo; Worker stores with the draft in D1.",
        p10: mc ? mc.P10 : null,
        p50: mc ? mc.P50 : null,
        p90: mc ? mc.P90 : null,
        p_profit: mc ? mc.pProfit : null,
        break_even_ticket: b.K2 != null ? b.K2 : null,
        pnl_by_dept: depts,
        assumption_ledger: Array.isArray(state.ledger) ? state.ledger : [],
      },
    };
  }

  function safeRequire(p) {
    try { return typeof require === "function" ? require(p) : null; } catch (e) { return null; }
  }
  function loadSchema() {
    return safeRequire("../docs/event-draft.v1.schema.json") || (safeRequire("./event_draft_schema.js") || {}).schema || null;
  }

  /** Field key a local error refers to: "venue.name required" → "venue.name"; "lineup[0] times…" → "lineup[0]". */
  function fieldOf(e) {
    var tok = String(e).split(" ")[0];
    if (tok === "start" && /before end/.test(e)) return "end";
    return tok;
  }

  function validateEventDraft(d) {
    var errors = [];
    if (!d || typeof d !== "object") return { ok: false, errors: ["draft missing"] };
    if (d.version !== VERSION) errors.push("version must be " + VERSION);
    if (!str(d.name)) errors.push("name required");
    var re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
    if (!re.test(d.start || "")) errors.push("start must be YYYY-MM-DDTHH:mm");
    if (!re.test(d.end || "")) errors.push("end must be YYYY-MM-DDTHH:mm");
    if (re.test(d.start || "") && re.test(d.end || "") && !(d.start < d.end)) errors.push("start must be before end");
    if (!/^[A-Za-z_]+\/[A-Za-z0-9_+\-\/]+$/.test(d.timezone || "") && d.timezone !== "UTC") errors.push("timezone must be IANA");
    var v = d.venue || {};
    ["name", "street", "city", "state", "zip"].forEach(function (k) {
      if (!str(v[k])) errors.push("venue." + k + " required");
    });
    if (!(Number(d.capacity) > 0)) errors.push("capacity must be > 0");
    else if (Number(d.capacity) > 100000) errors.push("capacity must be <= 100000");
    (d.tickets || []).forEach(function (t, i) {
      if (!str(t.name)) errors.push("tickets[" + i + "].name required");
      if (Number(t.price) !== 0) errors.push("tickets[" + i + "].price must be 0 (pay at door)");
    });
    (d.lineup || []).forEach(function (a, i) {
      if (a.name == null || typeof a.name !== "string") errors.push("lineup[" + i + "].name must be a string ('' = unnamed slot)");
      if (!re.test(a.start || "") || !re.test(a.end || "")) errors.push("lineup[" + i + "] times invalid");
      else if (a.start < d.start || a.end > d.end || !(a.start < a.end)) errors.push("lineup[" + i + "] must fall inside event start..end");
    });
    // Canonical schema (organizer repo) — authoritative shape check
    var schema = global.EVENT_DRAFT_SCHEMA || loadSchema();
    var Lite = global.SchemaLite || safeRequire("./schema_lite.js");
    if (schema && Lite) {
      // Dedupe: hide schema messages for fields our local checks already flagged.
      var flagged = {};
      errors.forEach(function (e) { flagged[fieldOf(e)] = 1; });
      Lite.validate(schema, d).forEach(function (e) {
        var m = /^\$\.?([^:]*):/.exec(e);
        var f = m ? m[1] : "";
        var top = f.replace(/\[\d+\].*$/, "").split(".")[0];
        if (flagged[f] || flagged[f.replace(/\[\d+\]$/, "")] || flagged[top + "*"]) return;
        errors.push("schema " + e);
      });
    } else {
      errors.push("canonical schema not loaded");
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /** Odoo-bound payload only (strip D1-only forecast). */
  function odooFields(d) {
    var o = Object.assign({}, d);
    delete o.forecast;
    return o;
  }

  var api = { VERSION: VERSION, buildEventDraft: buildEventDraft, validateEventDraft: validateEventDraft,
    odooFields: odooFields, isActRow: isActRow, isPlaceholderName: isPlaceholderName, _isoLocal: isoLocal };
  global.EventDraft = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
