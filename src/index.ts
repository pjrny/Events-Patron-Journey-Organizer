// Patron Journey Event Organizer Platform - Worker entry.
// Slice 2: organizer auth (magic link + PIN -> JWT), create/update/publish/archive events on Odoo.
import { type Env, secretNames } from "./env";
import { json, html, errorResponse, HttpError, clientIp } from "./http";
import { timingSafeEqual } from "./crypto";
import { ensureSchema, tableCounts, audit } from "./db";
import { cachePut, cacheGet, cacheDel } from "./cache";
import { resolveOdooKey, odoo, OdooError } from "./odoo";
import { runReadProbe, runWriteProbe } from "./probe";
import {
  requireOrganizer, authenticate, requestMagicLink, consumeMagicLink, pinLogin, sessionCookie, clearSessionCookie,
  revokeSession, setOrganizerPin, upsertOrganizer, normalizeEmail, getOrganizerByEmail, issueMagicToken, baseUrl, validatePin,
} from "./auth";
import { createEvent, updateEvent, archiveEvent, publishEvent, listEvents, eventSummary, readEventBody } from "./events";
import { requireOwnership } from "./db";
import { shell, dashboardPage, magicConfirmPage, errorPage } from "./dashboard";

const VERSION = "0.2.0-slice2";

function requireAdmin(req: Request, env: Env): void {
  if (!env.ADMIN_TOKEN) throw new HttpError(503, "ADMIN_TOKEN secret is not configured on this Worker", "admin_not_configured");
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : req.headers.get("x-admin-token") ?? "";
  if (!token || !timingSafeEqual(token, env.ADMIN_TOKEN)) throw new HttpError(401, "Admin token required", "unauthorized");
}

async function body(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Body must be JSON", "invalid_input");
  }
}

const publicOrganizer = (o: any) => o && { id: o.id, email: o.email, display_name: o.display_name, odoo_partner_id: o.odoo_partner_id, odoo_user_id: o.odoo_user_id, role: o.role, tier: o.tier, active: o.active, pin_set: !!o.pin_hash };

const READONLY_METHODS = new Set(["search_read", "read", "search_count", "fields_get"]);
const READONLY_MODELS = /^(event\.[a-z.]+|mail\.mail|website|res\.partner|res\.country(\.state)?|ir\.attachment)$/;

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method.toUpperCase();

  if (method === "GET" && pathname === "/") {
    return html(shell(env, "Patron Journey Organizer", `<p>Organizer dashboard for events on
      <a href="${env.PUBLIC_EVENTS_URL}">patronjourney.com</a> and pjrny.com. Attendees register on the native event pages.</p>
      <p><a href="/dashboard">Open the dashboard</a></p>`));
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
      auth: { jwt_secret: !!env.JWT_SECRET, pin_pepper: !!env.PIN_PEPPER },
      odoo: { url: env.ODOO_URL, template_event_id: Number(env.ODOO_TEMPLATE_EVENT_ID), api_key_bound: !!resolveOdooKey(env) },
    });
  }

  if (method === "GET" && pathname === "/api/config") {
    return json({ paid_upgrade_url: env.PAID_UPGRADE_URL, public_events_url: env.PUBLIC_EVENTS_URL, ticket_types: ["General Admission", "Pay At Door", "Volunteer", "Staff"] });
  }

  await ensureSchema(env);

  // ---------- Dashboard pages ----------
  if (method === "GET" && (pathname === "/dashboard" || pathname.startsWith("/dashboard/"))) return html(dashboardPage(env));

  if (pathname === "/auth/magic") {
    if (method === "GET") return html(magicConfirmPage(env, url.searchParams.get("token") ?? ""));
    if (method === "POST") {
      const fd = await req.formData().catch(() => null);
      try {
        const s = await consumeMagicLink(env, req, fd?.get("token"));
        return new Response(null, { status: 303, headers: { location: "/dashboard", "set-cookie": sessionCookie(s.token, s.max_age), "cache-control": "no-store" } });
      } catch (e) {
        if (e instanceof HttpError) return html(errorPage(env, e.message), e.status);
        throw e;
      }
    }
  }

  // ---------- Auth API ----------
  if (pathname.startsWith("/api/auth/")) {
    if (method === "POST" && pathname === "/api/auth/magic-link") {
      const b = await body(req);
      const r = await requestMagicLink(env, req, b.email);
      // Same answer for known/unknown emails (no enumeration). Delivery status is in the audit log.
      return json({ ok: true, message: "If that email belongs to an organizer, a sign-in link has been sent.", ...(r.throttled ? { throttled: true } : {}) }, r.throttled ? 429 : 200);
    }
    if (method === "POST" && pathname === "/api/auth/magic/verify") {
      const b = await body(req);
      const s = await consumeMagicLink(env, req, b.token);
      return json({ ok: true, token: s.token, expires_at: s.expires_at, organizer: publicOrganizer(s.organizer) }, 200, { "set-cookie": sessionCookie(s.token, s.max_age) });
    }
    if (method === "POST" && pathname === "/api/auth/pin") {
      const b = await body(req);
      const s = await pinLogin(env, req, b.email, b.pin);
      return json({ ok: true, token: s.token, expires_at: s.expires_at, organizer: publicOrganizer(s.organizer) }, 200, { "set-cookie": sessionCookie(s.token, s.max_age) });
    }
    if (method === "POST" && pathname === "/api/auth/logout") {
      const a = await authenticate(req, env);
      if (a) {
        await revokeSession(env, a.claims.sid);
        await audit(env, { organizerId: a.organizer.id, action: "auth.logout", ip: clientIp(req) });
      }
      return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
    }
    if (method === "GET" && pathname === "/api/auth/me") {
      const a = await requireOrganizer(req, env);
      return json({ ok: true, organizer: publicOrganizer(a.organizer), session_expires_at: new Date(a.claims.exp * 1000).toISOString() });
    }
    throw new HttpError(404, "Unknown auth route", "not_found");
  }

  // ---------- Organizer API (JWT required on every route) ----------
  const isOrgApi = pathname.startsWith("/api/organizer/") || pathname === "/api/events" || pathname.startsWith("/api/events/");
  if (isOrgApi) {
    const a = await requireOrganizer(req, env);
    const org = a.organizer;
    const p = pathname.replace(/^\/api\/organizer/, "/api");

    if (method === "POST" && p === "/api/pin") {
      const b = await body(req);
      await setOrganizerPin(env, org.id, validatePin(b.pin));
      await audit(env, { organizerId: org.id, action: "auth.pin_set", ip: clientIp(req) });
      return json({ ok: true });
    }
    if (method === "GET" && p === "/api/events") return json(await listEvents(env, org));
    if (method === "POST" && p === "/api/events") return json(await createEvent(env, req, org, await readEventBody(req)), 201);

    const m = /^\/api\/events\/(\d+)(\/[a-z]+)?$/.exec(p);
    if (m) {
      const eventId = Number(m[1]);
      const sub = m[2] ?? "";
      if (method === "GET" && sub === "") {
        const own = await requireOwnership(env, org.id, eventId);
        return json({ ok: true, ownership: own, event: await eventSummary(env, eventId) });
      }
      if ((method === "PATCH" || method === "PUT") && sub === "") return json(await updateEvent(env, req, org, eventId, await readEventBody(req)));
      if (method === "POST" && sub === "/archive") return json(await archiveEvent(env, req, org, eventId));
      if (method === "POST" && sub === "/publish") {
        const b = await body(req);
        return json(await publishEvent(env, req, org, eventId, b.published !== false));
      }
    }
    throw new HttpError(404, "Unknown organizer route", "not_found");
  }

  // ---------- Admin (Bearer ADMIN_TOKEN) ----------
  if (pathname.startsWith("/api/admin/")) {
    requireAdmin(req, env);

    if (method === "GET" && pathname === "/api/admin/diag") {
      const k = `diag:${crypto.randomUUID()}`;
      await cachePut(env, k, { t: Date.now() }, 60);
      const kvOk = env.CACHE ? (await cacheGet(env, k)) !== null : "not_bound";
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

    if (method === "GET" && pathname === "/api/admin/odoo/probe") return json(await runReadProbe(env, { full: url.searchParams.get("full") === "1" }));

    if (method === "POST" && pathname === "/api/admin/odoo/probe-write") {
      if (url.searchParams.get("confirm") !== "yes") throw new HttpError(400, "Add ?confirm=yes to create the disposable probe event", "confirm_required");
      const result = await runWriteProbe(env);
      if (!result.reused) {
        await audit(env, { action: "probe.event_copied", odooModel: "event.event", odooId: result.probe_event_id, odooEventId: result.probe_event_id, detail: result, ip: clientIp(req) });
      }
      return json({ ok: true, ...result });
    }

    /** Read-only Odoo passthrough for verification (search_read/read/search_count/fields_get on event/mail/website/partner models). */
    if (method === "POST" && pathname === "/api/admin/odoo/read") {
      const b = await body(req);
      if (!READONLY_METHODS.has(b.method) || !READONLY_MODELS.test(String(b.model))) throw new HttpError(400, "Only read methods on event/mail/website/partner models", "invalid_input");
      const { model, method: mth, ...args } = b;
      return json({ ok: true, result: await odoo(env).call(model, mth, args) });
    }

    /** Create/refresh an organizer, link its Odoo contact, optionally set a PIN (body.pin or body.pin_from_env = "TEST_ORGANIZER_PIN"). */
    if (method === "POST" && pathname === "/api/admin/organizers") {
      const b = await body(req);
      const email = normalizeEmail(b.email);
      const partners = await odoo(env).call<any[]>("res.partner", "search_read", { domain: [["email", "=ilike", email]], fields: ["id", "name", "user_ids"], limit: 1 });
      const p = partners[0];
      let org = await upsertOrganizer(env, { email, odoo_partner_id: p?.id ?? null, display_name: b.display_name ?? p?.name ?? null, role: b.role === "admin" ? "admin" : "organizer" });
      if (p?.user_ids?.length) await env.DB.prepare("UPDATE organizers SET odoo_user_id = ? WHERE id = ?").bind(p.user_ids[0], org.id).run();
      let pinSet = false;
      if (b.pin_from_env) {
        if (b.pin_from_env !== "TEST_ORGANIZER_PIN") throw new HttpError(400, "pin_from_env must be TEST_ORGANIZER_PIN", "invalid_input");
        if (!env.TEST_ORGANIZER_PIN) throw new HttpError(400, "TEST_ORGANIZER_PIN secret is not set", "invalid_input");
        await setOrganizerPin(env, org.id, env.TEST_ORGANIZER_PIN);
        pinSet = true;
      } else if (b.pin !== undefined) {
        await setOrganizerPin(env, org.id, String(b.pin));
        pinSet = true;
      }
      org = (await getOrganizerByEmail(env, email))!;
      await audit(env, { action: "organizer.ensured", detail: { organizer_id: org.id, email, odoo_partner_id: org.odoo_partner_id, pin_set: pinSet }, ip: clientIp(req) });
      return json({ ok: true, organizer: publicOrganizer(org), odoo_partner: p ? { id: p.id, name: p.name } : null });
    }

    /** Test helper: mint a one-time magic link WITHOUT emailing it (lets the smoke test exercise /auth/magic). */
    if (method === "POST" && pathname === "/api/admin/organizers/magic-link") {
      const b = await body(req);
      const org = await getOrganizerByEmail(env, normalizeEmail(b.email));
      if (!org) throw new HttpError(404, "No such organizer", "not_found");
      const token = await issueMagicToken(env, org.id);
      await audit(env, { organizerId: org.id, action: "admin.magic_link_minted", ip: clientIp(req) });
      return json({ ok: true, token, link: `${baseUrl(env, req)}/auth/magic?token=${encodeURIComponent(token)}` });
    }

    if (method === "GET" && pathname === "/api/admin/audit") {
      const limit = Math.min(200, Number(url.searchParams.get("limit") || 30));
      const r = await env.DB.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?").bind(limit).all();
      return json({ ok: true, audit: r.results });
    }

    if (method === "GET" && pathname === "/api/admin/ownership") {
      const ev = url.searchParams.get("odoo_event_id");
      const r = ev
        ? await env.DB.prepare("SELECT oe.*, o.email FROM organizer_events oe JOIN organizers o ON o.id = oe.organizer_id WHERE oe.odoo_event_id = ?").bind(Number(ev)).all()
        : await env.DB.prepare("SELECT oe.*, o.email FROM organizer_events oe JOIN organizers o ON o.id = oe.organizer_id ORDER BY oe.id DESC LIMIT 100").all();
      return json({ ok: true, ownership: r.results });
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
      if (e instanceof OdooError) {
        console.error("odoo", e.status, e.odooName, e.message.slice(0, 200));
        return json({ ok: false, error: "odoo_error", odoo_status: e.status, message: e.message.slice(0, 400) }, 502);
      }
      return errorResponse(e);
    }
  },
} satisfies ExportedHandler<Env>;
