// Patron Journey Event Organizer Platform - Worker entry.
// Slice 1: health, D1 bootstrap, KV cache stubs, admin-gated Odoo discovery probe.
import { type Env, secretNames } from "./env";
import { json, html, errorResponse, HttpError, clientIp } from "./http";
import { timingSafeEqual } from "./crypto";
import { ensureSchema, tableCounts, audit } from "./db";
import { cachePut, cacheGet, cacheDel } from "./cache";
import { resolveOdooKey } from "./odoo";
import { runReadProbe, runWriteProbe } from "./probe";

const VERSION = "0.1.0-slice1";

function requireAdmin(req: Request, env: Env): void {
  if (!env.ADMIN_TOKEN) throw new HttpError(503, "ADMIN_TOKEN secret is not configured on this Worker", "admin_not_configured");
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : req.headers.get("x-admin-token") ?? "";
  if (!token || !timingSafeEqual(token, env.ADMIN_TOKEN)) throw new HttpError(401, "Admin token required", "unauthorized");
}

const page = (env: Env, title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | Patron Journey Organizer</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:3rem auto;padding:0 1rem;color:#1d1d1f}
a{color:#6b3fa0}code{background:#f3f3f3;padding:.1rem .3rem;border-radius:4px}nav a{margin-right:1rem}</style></head>
<body><h1>${title}</h1>${body}
<hr><p><small>Free tier: free and pay-at-door tickets only. Paid tickets, POS, RFID, mobile apps and advanced attendance:
<a href="${env.PAID_UPGRADE_URL}">contact Patron Journey</a>.</small></p></body></html>`;

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method.toUpperCase();

  if (method === "GET" && pathname === "/") {
    return html(
      page(env, "Patron Journey Organizer", `<p>Organizer dashboard for events on
      <a href="${env.PUBLIC_EVENTS_URL}">patronjourney.com</a> and pjrny.com. Attendees register on the native event pages.</p>
      <nav><a href="/dashboard">Dashboard</a><a href="/health">Health</a></nav>`),
    );
  }

  if (method === "GET" && pathname.startsWith("/dashboard")) {
    return html(
      page(env, "Organizer Dashboard", `<p>Sign-in (magic link or email + PIN) ships in the next slice.</p>
      <ul><li>My Events</li><li>Create Event</li><li>Attendees</li><li>Check-In Scanner</li><li>Speakers</li><li>Vendors</li><li>Settings</li><li>Support</li></ul>`),
    );
  }

  if (method === "GET" && pathname === "/health") {
    let d1: Record<string, unknown>;
    try {
      await ensureSchema(env);
      d1 = { ok: true, schema: "0001_init" };
    } catch (e) {
      d1 = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return json({
      ok: d1.ok === true,
      service: "events-patronjourney",
      version: VERSION,
      env: env.APP_ENV,
      time: new Date().toISOString(),
      bindings: { DB: !!env.DB, CACHE: !!env.CACHE },
      d1,
      odoo: { url: env.ODOO_URL, template_event_id: Number(env.ODOO_TEMPLATE_EVENT_ID), api_key_bound: !!resolveOdooKey(env) },
    });
  }

  if (method === "GET" && pathname === "/api/config") {
    return json({ paid_upgrade_url: env.PAID_UPGRADE_URL, public_events_url: env.PUBLIC_EVENTS_URL, ticket_types: ["General Admission", "Pay At Door", "Volunteer", "Staff"] });
  }

  // ---------- Admin (Bearer ADMIN_TOKEN) ----------
  if (pathname.startsWith("/api/admin/")) {
    requireAdmin(req, env);
    await ensureSchema(env);

    if (method === "GET" && pathname === "/api/admin/diag") {
      const k = `diag:${crypto.randomUUID()}`;
      await cachePut(env, k, { t: Date.now() }, 60);
      const kvOk = (await cacheGet(env, k)) !== null;
      ctx.waitUntil(cacheDel(env, k));
      return json({
        ok: true,
        version: VERSION,
        secret_names: secretNames(env), // NAMES only
        odoo_key_binding_name: resolveOdooKey(env)?.name ?? null,
        d1_counts: await tableCounts(env),
        kv_roundtrip: kvOk,
      });
    }

    if (method === "GET" && pathname === "/api/admin/odoo/probe") {
      const result = await runReadProbe(env, { full: url.searchParams.get("full") === "1" });
      return json(result);
    }

    if (method === "POST" && pathname === "/api/admin/odoo/probe-write") {
      if (url.searchParams.get("confirm") !== "yes") throw new HttpError(400, "Add ?confirm=yes to create the disposable probe event", "confirm_required");
      const result = await runWriteProbe(env);
      if (!result.reused) {
        await audit(env, { action: "probe.event_copied", odooModel: "event.event", odooId: result.probe_event_id, odooEventId: result.probe_event_id, detail: result, ip: clientIp(req) });
      }
      return json({ ok: true, ...result });
    }

    throw new HttpError(404, "Unknown admin route", "not_found");
  }

  if (pathname.startsWith("/api/")) throw new HttpError(404, "Not implemented yet", "not_found");
  throw new HttpError(404, "Not found", "not_found");
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(req, env, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  },
} satisfies ExportedHandler<Env>;
