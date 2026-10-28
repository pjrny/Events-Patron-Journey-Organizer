/**
 * "Create this event" client — posts an event-draft.v1 to the organizer Worker.
 * No cookies are set or read here. Signed-out drafts stay in localStorage.
 *
 * Config (window.FORECASTER_CONFIG, all optional):
 *   WORKER_BASE        default "https://events-patronjourney.message-0ad.workers.dev" ("" = same origin)
 *   SAME_ORIGIN_SIGNED_IN  true when served as the Worker's Simulate tab with a session
 *   PAID_EVENT_URL     default "https://www.pjrny.com/#Contact-us"
 */
(function (global) {
  "use strict";

  var DEFAULTS = { WORKER_BASE: "https://events-patronjourney.message-0ad.workers.dev", SAME_ORIGIN_SIGNED_IN: false, PAID_EVENT_URL: "https://www.pjrny.com/#Contact-us" };

  function cfg(over) {
    return Object.assign({}, DEFAULTS, global.FORECASTER_CONFIG || {}, over || {});
  }

  function base(c) { return String(c.WORKER_BASE || "").replace(/\/+$/, ""); }

  async function postJson(fetchFn, url, body, sameOrigin) {
    var res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body == null ? "{}" : JSON.stringify(body),
      // anonymous mode never sends cookies; signed-in mode is same-origin only
      credentials: sameOrigin ? "same-origin" : "omit",
    });
    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
    if (!res.ok) {
      var err = new Error((data && (data.error || data.message)) || ("HTTP " + res.status));
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  /**
   * Returns { mode, draft_id, claim_url? , dashboard_url?, odoo_event_id? }.
   * deps: { fetch, open(url), redirect(url) } — injectable for tests.
   */
  async function createFreeEvent(draft, over, deps) {
    var c = cfg(over);
    deps = deps || {};
    // Events are always created UNPUBLISHED: never send publish:true.
    if (draft && Object.prototype.hasOwnProperty.call(draft, "publish")) {
      draft = Object.assign({}, draft);
      delete draft.publish;
    }
    var fetchFn = deps.fetch || global.fetch.bind(global);
    var b = base(c);
    if (c.SAME_ORIGIN_SIGNED_IN) {
      var saved = await postJson(fetchFn, b + "/api/organizer/drafts", draft, true);
      if (!saved || !saved.draft_id) throw new Error("Worker did not return draft_id");
      var created = await postJson(fetchFn, b + "/api/organizer/drafts/" + encodeURIComponent(saved.draft_id) + "/create", {}, true); // body {} → unpublished
      if (!created || !created.dashboard_url) throw new Error("Worker did not return dashboard_url");
      (deps.redirect || function (u) { global.location.assign(u); })(created.dashboard_url);
      return { mode: "signed_in", draft_id: saved.draft_id, odoo_event_id: created.odoo_event_id, dashboard_url: created.dashboard_url, public_url: created.public_url };
    }
    var anon = await postJson(fetchFn, b + "/api/drafts", draft, false);
    if (!anon || !anon.draft_id || !anon.claim_token) throw new Error("Worker did not return draft_id/claim_token");
    var claimUrl = b + "/claim?draft=" + encodeURIComponent(anon.draft_id) + "&t=" + encodeURIComponent(anon.claim_token);
    if (anon.claim_url && /^https?:\/\//.test(anon.claim_url)) claimUrl = anon.claim_url;
    (deps.open || function (u) { global.open(u, "_blank", "noopener"); })(claimUrl);
    return { mode: "anonymous", draft_id: anon.draft_id, claim_url: claimUrl };
  }

  var api = { createFreeEvent: createFreeEvent, config: cfg, DEFAULTS: DEFAULTS };
  global.CreateEvent = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
