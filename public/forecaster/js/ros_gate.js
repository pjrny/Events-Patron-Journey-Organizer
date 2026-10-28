/**
 * ROS gate — must Confirm before Monte Carlo Run is enabled.
 * Option 1: editable table time|area|action|owner
 * Option 2: generate skeleton from profile; still requires Confirm
 */
(function (global) {
  "use strict";

  var REQUIRED_ACTIONS = ["gates", "first_set", "doors", "peak", "last_set", "egress"];
  var CAMP_REQUIRED = "camp_open";

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function parseDate(s) {
    if (!s) return null;
    var d = new Date(s + (s.length <= 10 ? "T12:00:00" : ""));
    return isNaN(d.getTime()) ? null : d;
  }

  function dayCount(start, end) {
    var a = parseDate(start);
    var b = parseDate(end);
    if (!a || !b) return 1;
    var ms = Math.max(0, b.getTime() - a.getTime());
    return Math.max(1, Math.round(ms / 86400000) + 1);
  }

  function hhmm(h, m) {
    return pad(h) + ":" + pad(m || 0);
  }

  /**
   * Generate skeleton ROS rows from event profile.
   */
  function generateSkeleton(profile) {
    profile = profile || {};
    var days = Number(profile.show_days) || dayCount(profile.start_date, profile.end_date) || 3;
    var camping = !!profile.camping;
    var city = profile.city || "Venue city";
    var cashless = profile.cashlessMode || profile.cashless || "hybrid";
    var rows = [];
    var d;

    // Pre-show / load-in day 0 cues
    rows.push({
      time: "08:00",
      area: "Sitewide",
      action: "gates",
      owner: "Security Lead",
      day: 0,
      note: "Staff gates brief — " + city,
    });
    rows.push({
      time: "09:00",
      area: "Box office",
      action: "will_call_open",
      owner: "Ticketing",
      day: 0,
      note: "Cashless mode: " + cashless,
    });

    if (camping) {
      rows.push({
        time: "10:00",
        area: "Campground",
        action: CAMP_REQUIRED,
        owner: "Camp Ops",
        day: 0,
        note: "Camp open — fire lanes clear",
      });
    }

    for (d = 1; d <= days; d++) {
      rows.push({
        time: hhmm(11, 0),
        area: "Gates",
        action: "doors",
        owner: "Security Lead",
        day: d,
        note: "Doors / public ingress Day " + d,
      });
      rows.push({
        time: hhmm(12, 0),
        area: "Main Stage",
        action: "first_set",
        owner: "Stage Manager",
        day: d,
        note: "First set Day " + d,
      });
      rows.push({
        time: hhmm(18, 30),
        area: "Sitewide",
        action: "peak",
        owner: "Festival Director",
        day: d,
        note: "Peak attendance window Day " + d,
      });
      rows.push({
        time: hhmm(22, 0),
        area: "Main Stage",
        action: "last_set",
        owner: "Stage Manager",
        day: d,
        note: "Last set Day " + d,
      });
    }

    rows.push({
      time: hhmm(23, 30),
      area: "Sitewide",
      action: "egress",
      owner: "Security Lead",
      day: days,
      note: "Public egress — lot release staged",
    });

    return {
      rows: rows,
      meta: {
        days: days,
        camping: camping,
        cashless: cashless,
        city: city,
        start_date: profile.start_date || "",
        end_date: profile.end_date || "",
        generated: true,
      },
    };
  }

  function normalizeAction(a) {
    return String(a || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
  }

  /**
   * Validate ROS rows. Returns { ok, errors[], missing[] }.
   */
  function validate(rows, opts) {
    opts = opts || {};
    var camping = !!opts.camping;
    var errors = [];
    var missing = [];
    var found = {};
    var list = Array.isArray(rows) ? rows : [];

    if (!list.length) {
      errors.push("ROS is empty — add rows or generate a skeleton.");
      return { ok: false, errors: errors, missing: REQUIRED_ACTIONS.slice() };
    }

    list.forEach(function (r, i) {
      if (!r.time || !String(r.time).trim()) errors.push("Row " + (i + 1) + ": time required");
      if (!r.area || !String(r.area).trim()) errors.push("Row " + (i + 1) + ": area required");
      if (!r.action || !String(r.action).trim()) errors.push("Row " + (i + 1) + ": action required");
      if (!r.owner || !String(r.owner).trim()) errors.push("Row " + (i + 1) + ": owner required");
      var act = normalizeAction(r.action);
      found[act] = true;
      // aliases
      if (act === "gate" || act === "gate_open") found.gates = true;
      if (act === "door" || act === "doors_open") found.doors = true;
      if (act === "firstset" || act === "first-set") found.first_set = true;
      if (act === "lastset" || act === "last-set") found.last_set = true;
      if (act === "camp-open" || act === "campopen" || act === "camping_open")
        found[CAMP_REQUIRED] = true;
    });

    REQUIRED_ACTIONS.forEach(function (req) {
      if (!found[req]) missing.push(req);
    });
    if (camping && !found[CAMP_REQUIRED]) missing.push(CAMP_REQUIRED);

    if (missing.length) {
      errors.push("Missing required actions: " + missing.join(", "));
    }

    return { ok: errors.length === 0, errors: errors, missing: missing };
  }

  /**
   * Build timeline cues (ms offsets compressed) from confirmed ROS for the presentation clock.
   */
  function timelineFromRos(rows, totalMs) {
    totalMs = totalMs || 30000;
    var list = (rows || []).slice().sort(function (a, b) {
      var da = Number(a.day) || 0;
      var db = Number(b.day) || 0;
      if (da !== db) return da - db;
      return String(a.time).localeCompare(String(b.time));
    });
    if (!list.length) return [];
    return list.map(function (r, i) {
      var t = list.length === 1 ? 0 : Math.round((i / (list.length - 1)) * totalMs);
      return {
        atMs: t,
        time: r.time,
        area: r.area,
        action: normalizeAction(r.action),
        owner: r.owner,
        day: r.day,
        note: r.note || "",
      };
    });
  }

  /** UI controller bound to DOM ids used by app. */
  function createController(cfg) {
    cfg = cfg || {};
    var state = {
      mode: null, // 'edit' | 'skeleton'
      rows: [],
      meta: null,
      confirmed: false,
      confirmedRows: null,
    };

    function getCamping() {
      return typeof cfg.getCamping === "function" ? !!cfg.getCamping() : false;
    }

    function getProfile() {
      return typeof cfg.getProfile === "function" ? cfg.getProfile() : {};
    }

    function setRunEnabled(on) {
      if (typeof cfg.setRunEnabled === "function") cfg.setRunEnabled(!!on);
    }

    function notify(msg, kind) {
      if (typeof cfg.onStatus === "function") cfg.onStatus(msg, kind || "info");
    }

    function renderTable(rows) {
      var body = document.getElementById(cfg.tableBodyId || "rosTableBody");
      if (!body) return;
      body.innerHTML = "";
      rows.forEach(function (r, idx) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td><input data-f='time' data-i='" +
          idx +
          "' value='" +
          escapeAttr(r.time || "") +
          "' /></td>" +
          "<td><input data-f='area' data-i='" +
          idx +
          "' value='" +
          escapeAttr(r.area || "") +
          "' /></td>" +
          "<td><input data-f='action' data-i='" +
          idx +
          "' value='" +
          escapeAttr(r.action || "") +
          "' /></td>" +
          "<td><input data-f='owner' data-i='" +
          idx +
          "' value='" +
          escapeAttr(r.owner || "") +
          "' /></td>" +
          "<td class='ros-day'>" +
          (r.day != null ? r.day : "") +
          "</td>";
        body.appendChild(tr);
      });
      body.querySelectorAll("input").forEach(function (inp) {
        inp.addEventListener("change", function () {
          var i = Number(inp.getAttribute("data-i"));
          var f = inp.getAttribute("data-f");
          if (state.rows[i]) state.rows[i][f] = inp.value;
          state.confirmed = false;
          setRunEnabled(false);
        });
      });
    }

    function escapeAttr(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;");
    }

    function showPanel(show) {
      var el = document.getElementById(cfg.panelId || "rosGatePanel");
      if (el) el.hidden = !show;
    }

    function startEditEmpty() {
      state.mode = "edit";
      state.confirmed = false;
      state.confirmedRows = null;
      setRunEnabled(false);
      state.rows = [
        { time: "11:00", area: "Gates", action: "gates", owner: "", day: 1 },
        { time: "12:00", area: "Main Stage", action: "doors", owner: "", day: 1 },
        { time: "13:00", area: "Main Stage", action: "first_set", owner: "", day: 1 },
        { time: "18:30", area: "Sitewide", action: "peak", owner: "", day: 1 },
        { time: "22:00", area: "Main Stage", action: "last_set", owner: "", day: 1 },
        { time: "23:30", area: "Sitewide", action: "egress", owner: "", day: 1 },
      ];
      if (getCamping()) {
        state.rows.splice(1, 0, {
          time: "10:00",
          area: "Campground",
          action: "camp_open",
          owner: "",
          day: 0,
        });
      }
      state.meta = { generated: false, camping: getCamping() };
      renderTable(state.rows);
      showPanel(true);
      notify("Edit your ROS table, then Confirm ROS.", "info");
    }

    function startSkeleton() {
      state.mode = "skeleton";
      state.confirmed = false;
      state.confirmedRows = null;
      setRunEnabled(false);
      var profile = getProfile();
      profile.camping = getCamping();
      var sk = generateSkeleton(profile);
      state.rows = sk.rows;
      state.meta = sk.meta;
      renderTable(state.rows);
      showPanel(true);
      notify(
        "Skeleton ROS for " +
          sk.meta.days +
          " show day(s)" +
          (sk.meta.camping ? " · camping on" : "") +
          " · " +
          (sk.meta.city || "") +
          ". Review, then Confirm ROS.",
        "info"
      );
    }

    function readRowsFromDom() {
      // state.rows already updated on change; re-read to be safe
      var body = document.getElementById(cfg.tableBodyId || "rosTableBody");
      if (!body) return state.rows;
      var inputs = body.querySelectorAll("input");
      inputs.forEach(function (inp) {
        var i = Number(inp.getAttribute("data-i"));
        var f = inp.getAttribute("data-f");
        if (state.rows[i]) state.rows[i][f] = inp.value;
      });
      return state.rows;
    }

    function confirm() {
      var rows = readRowsFromDom();
      var v = validate(rows, { camping: getCamping() });
      var errEl = document.getElementById(cfg.errorId || "rosGateErrors");
      if (!v.ok) {
        state.confirmed = false;
        setRunEnabled(false);
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = v.errors.join(" ");
        }
        notify(v.errors[0] || "ROS validation failed", "warn");
        return false;
      }
      if (errEl) {
        errEl.hidden = true;
        errEl.textContent = "";
      }
      state.confirmed = true;
      state.confirmedRows = rows.map(function (r) {
        return Object.assign({}, r);
      });
      setRunEnabled(true);
      notify("ROS confirmed — Monte Carlo Run enabled.", "pass");
      var badge = document.getElementById(cfg.badgeId || "rosConfirmedBadge");
      if (badge) {
        badge.hidden = false;
        badge.textContent = "ROS Confirmed (" + rows.length + " rows)";
      }
      return true;
    }

    function edit() {
      state.confirmed = false;
      state.confirmedRows = null;
      setRunEnabled(false);
      showPanel(true);
      if (!state.rows.length) startEditEmpty();
      else renderTable(state.rows);
      var badge = document.getElementById(cfg.badgeId || "rosConfirmedBadge");
      if (badge) badge.hidden = true;
      notify("Editing ROS — Run Monte Carlo disabled until Confirm.", "info");
    }

    function cancel() {
      state.mode = null;
      if (!state.confirmed) {
        state.rows = [];
        setRunEnabled(false);
      }
      showPanel(false);
      notify(state.confirmed ? "Kept confirmed ROS." : "ROS gate cancelled.", "info");
    }

    function isConfirmed() {
      return !!state.confirmed && Array.isArray(state.confirmedRows);
    }

    function getConfirmedRos() {
      return isConfirmed()
        ? { rows: state.confirmedRows.slice(), meta: state.meta }
        : null;
    }

    return {
      startEditEmpty: startEditEmpty,
      startSkeleton: startSkeleton,
      confirm: confirm,
      edit: edit,
      cancel: cancel,
      isConfirmed: isConfirmed,
      getConfirmedRos: getConfirmedRos,
      validate: validate,
      generateSkeleton: generateSkeleton,
      state: state,
    };
  }

  global.RosGate = {
    REQUIRED_ACTIONS: REQUIRED_ACTIONS,
    CAMP_REQUIRED: CAMP_REQUIRED,
    generateSkeleton: generateSkeleton,
    validate: validate,
    timelineFromRos: timelineFromRos,
    dayCount: dayCount,
    createController: createController,
  };
})(typeof window !== "undefined" ? window : global);
