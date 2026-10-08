// Organizer event lifecycle on top of Odoo (source of truth).
// Create = copy the Patron Journey template event (Testival, id 14), record ownership in D1
// immediately, then patch fields, tickets, sponsor, default track, image, publish.
import type { Env } from "./env";
import { HttpError, clientIp } from "./http";
import { odoo, OdooError, type OdooClient } from "./odoo";
import { audit, requireOwnership } from "./db";
import { parseEventDate, isValidTz, toOdooUtc, odooUtcToLocal } from "./time";
import type { Organizer } from "./auth";

export const ALLOWED_TAGS = ["Festival", "Community", "Music", "Networking", "Conference"];
const MAX_CAPACITY = 100000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface VenueInput { id?: number; name?: string; street?: string; city?: string; state?: string; zip?: string; country?: string }
export interface SpeakerInput { name?: string; title?: string; start?: string; end?: string; email?: string; bio?: string }
export interface ImageInput { data_base64?: string; mimetype?: string; filename?: string }
export interface EventInput {
  name?: string;
  subtitle?: string;
  description?: string;
  tags?: string[];
  start?: string;
  end?: string;
  timezone?: string;
  website_id?: number;
  venue?: VenueInput;
  capacity?: number;
  tickets?: { pay_at_door?: boolean; volunteer?: boolean; staff?: boolean };
  speaker?: SpeakerInput;
  publish?: boolean;
  image?: ImageInput;
}

type Ctx = { env: Env; req: Request; org: Organizer; o: OdooClient; warnings: string[] };

const m2oId = (v: unknown): number | null => (Array.isArray(v) ? Number(v[0]) : typeof v === "number" ? v : null);
const str = (v: unknown, max = 500): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const textToHtml = (s: string) => s.split(/\n{2,}/).map((p) => `<p>${escHtml(p).replace(/\n/g, "<br>")}</p>`).join("");

function allowedWebsites(env: Env): number[] {
  return String(env.ALLOWED_WEBSITE_IDS || "1,2").split(",").map((s) => Number(s.trim())).filter(Boolean);
}

async function auditM(c: Ctx, action: string, model: string, id: number | undefined, eventId: number | undefined, detail?: unknown) {
  await audit(c.env, { organizerId: c.org.id, action, odooModel: model, odooId: id, odooEventId: eventId, detail, ip: clientIp(c.req) });
}

async function create(o: OdooClient, model: string, vals: Record<string, unknown>): Promise<number> {
  const r = await o.call<number[] | number>(model, "create", { vals_list: [vals] });
  return Array.isArray(r) ? r[0] : r;
}

// ---------------- input normalisation ----------------

interface Normalized {
  name?: string;
  subtitle?: string;
  descriptionHtml?: string;
  tags?: string[];
  tz: string;
  dateBegin?: string;
  dateEnd?: string;
  websiteId?: number;
  venue?: VenueInput;
  capacity?: number;
  tickets?: { pay_at_door: boolean; volunteer: boolean; staff: boolean };
  speaker?: SpeakerInput;
  publish?: boolean;
  image?: { b64: string; mimetype: string; filename: string };
}

export function normalizeInput(body: EventInput, opts: { creating: boolean; currentTz?: string }): Normalized {
  const n: Normalized = { tz: opts.currentTz || "America/Chicago" };
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !isValidTz(body.timezone)) throw new HttpError(400, "Unknown timezone", "invalid_input");
    n.tz = body.timezone;
  }
  n.name = str(body.name, 200);
  if (opts.creating && !n.name) throw new HttpError(400, "Event name is required", "invalid_input");
  n.subtitle = str(body.subtitle, 200);
  if (body.description !== undefined) n.descriptionHtml = textToHtml(String(body.description).slice(0, 20000));
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) throw new HttpError(400, "tags must be an array", "invalid_input");
    n.tags = body.tags.map((t) => {
      const hit = ALLOWED_TAGS.find((a) => a.toLowerCase() === String(t).trim().toLowerCase());
      if (!hit) throw new HttpError(400, `Unknown tag "${t}". Allowed: ${ALLOWED_TAGS.join(", ")}`, "invalid_input");
      return hit;
    });
  }
  if (opts.creating || body.start !== undefined) n.dateBegin = parseEventDate(body.start, n.tz, "start");
  if (opts.creating || body.end !== undefined) n.dateEnd = parseEventDate(body.end, n.tz, "end");
  if (n.dateBegin && n.dateEnd && n.dateEnd <= n.dateBegin) throw new HttpError(400, "end must be after start", "invalid_input");
  if (body.website_id !== undefined || opts.creating) {
    const w = Number(body.website_id ?? 1);
    if (!Number.isInteger(w)) throw new HttpError(400, "website_id must be an integer", "invalid_input");
    n.websiteId = w;
  }
  if (body.capacity !== undefined || opts.creating) {
    const cap = Number(body.capacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > MAX_CAPACITY) throw new HttpError(400, `capacity must be a whole number 1-${MAX_CAPACITY}`, "invalid_input");
    n.capacity = cap;
  }
  if (body.venue !== undefined) {
    if (typeof body.venue !== "object" || body.venue === null) throw new HttpError(400, "venue must be an object", "invalid_input");
    if (!body.venue.id && !str(body.venue.name)) throw new HttpError(400, "venue needs an id or a name", "invalid_input");
    n.venue = body.venue;
  }
  if (body.tickets !== undefined || opts.creating) {
    const t = body.tickets ?? {};
    n.tickets = { pay_at_door: !!t.pay_at_door, volunteer: !!t.volunteer, staff: !!t.staff };
  }
  if (body.speaker !== undefined) {
    if (!str(body.speaker?.name)) throw new HttpError(400, "speaker.name is required", "invalid_input");
    n.speaker = body.speaker;
  }
  if (body.publish !== undefined) n.publish = !!body.publish;
  if (body.image && body.image.data_base64) {
    const b64 = String(body.image.data_base64).replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
    const mimetype = String(body.image.mimetype || "image/jpeg");
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(mimetype)) throw new HttpError(400, "image must be png, jpeg, webp or gif", "invalid_input");
    if ((b64.length * 3) / 4 > MAX_IMAGE_BYTES) throw new HttpError(413, "image is larger than 5 MB", "too_large");
    n.image = { b64, mimetype, filename: str(body.image.filename, 120) || `event-cover.${mimetype.split("/")[1].replace("jpeg", "jpg")}` };
  }
  return n;
}

/** Reads a create/patch request: JSON (image as base64) or multipart (field "data" = JSON, file field "image"). */
export async function readEventBody(req: Request): Promise<EventInput> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const raw = fd.get("data");
    let body: EventInput = {};
    if (typeof raw === "string" && raw) {
      try { body = JSON.parse(raw); } catch { throw new HttpError(400, "data must be JSON", "invalid_input"); }
    }
    const file = fd.get("image") as unknown;
    if (file && typeof file === "object" && "arrayBuffer" in (file as any)) {
      const f = file as File;
      if (f.size > MAX_IMAGE_BYTES) throw new HttpError(413, "image is larger than 5 MB", "too_large");
      const u8 = new Uint8Array(await f.arrayBuffer());
      let s = "";
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      body.image = { data_base64: btoa(s), mimetype: f.type || "image/jpeg", filename: f.name };
    }
    return body;
  }
  try {
    return (await req.json()) as EventInput;
  } catch {
    throw new HttpError(400, "Body must be JSON", "invalid_input");
  }
}

// ---------------- Odoo lookups ----------------

async function resolveWebsite(c: Ctx, websiteId: number): Promise<{ websiteId: number; companyId: number }> {
  if (!allowedWebsites(c.env).includes(websiteId)) throw new HttpError(400, `website_id must be one of ${allowedWebsites(c.env).join(", ")}`, "invalid_input");
  const rows = await c.o.call<any[]>("website", "search_read", { domain: [["id", "=", websiteId]], fields: ["company_id"] });
  if (!rows.length) throw new HttpError(400, "Website not found in Odoo", "invalid_input");
  return { websiteId, companyId: m2oId(rows[0].company_id) ?? 1 };
}

async function resolveTagIds(c: Ctx, names: string[]): Promise<number[]> {
  const ids: number[] = [];
  let categoryId: number | null = null;
  for (const name of names) {
    const found = await c.o.call<any[]>("event.tag", "search_read", { domain: [["name", "=ilike", name]], fields: ["id", "category_id"], limit: 1 });
    if (found.length) { ids.push(found[0].id); continue; }
    if (categoryId === null) {
      const anyTag = await c.o.call<any[]>("event.tag", "search_read", { domain: [["name", "=ilike", "Festival"]], fields: ["category_id"], limit: 1 });
      categoryId = m2oId(anyTag[0]?.category_id) ?? 1;
    }
    const id = await create(c.o, "event.tag", { name, category_id: categoryId });
    await auditM(c, "tag.created", "event.tag", id, undefined, { name });
    ids.push(id);
  }
  return ids;
}

/** Venue = res.partner used as event.event.address_id. Only partners already used as a venue may be referenced by id. */
async function resolveVenue(c: Ctx, v: VenueInput): Promise<{ id: number; name: string; created: boolean }> {
  if (v.id) {
    const used = await c.o.call<any[]>("event.event", "search_read", {
      domain: [["address_id", "=", Number(v.id)]], fields: ["address_id"], limit: 1, context: { active_test: false },
    });
    if (!used.length) throw new HttpError(400, "That venue id is not a known event venue", "invalid_input");
    return { id: Number(v.id), name: String(used[0].address_id[1]), created: false };
  }
  const name = str(v.name, 200)!;
  const city = str(v.city, 100);
  const domain: unknown[] = [["address_id.name", "=ilike", name]];
  if (city) domain.push(["address_id.city", "=ilike", city]);
  const existing = await c.o.call<any[]>("event.event", "search_read", { domain, fields: ["address_id"], limit: 1, context: { active_test: false } });
  if (existing.length) return { id: m2oId(existing[0].address_id)!, name: String(existing[0].address_id[1]), created: false };

  const vals: Record<string, unknown> = { name, is_company: true, type: "contact" };
  if (str(v.street)) vals.street = str(v.street);
  if (city) vals.city = city;
  if (str(v.zip, 20)) vals.zip = str(v.zip, 20);
  const countryQ = str(v.country, 60) || "US";
  const country = await c.o.call<any[]>("res.country", "search_read", {
    domain: countryQ.length === 2 ? [["code", "=ilike", countryQ]] : [["name", "=ilike", countryQ]], fields: ["id"], limit: 1,
  });
  if (country.length) vals.country_id = country[0].id;
  else c.warnings.push(`country "${countryQ}" not found; venue saved without country`);
  const stateQ = str(v.state, 60);
  if (stateQ && vals.country_id) {
    const st = await c.o.call<any[]>("res.country.state", "search_read", {
      domain: [["country_id", "=", vals.country_id], "|", ["code", "=ilike", stateQ], ["name", "=ilike", stateQ]], fields: ["id"], limit: 1,
    });
    if (st.length) vals.state_id = st[0].id;
    else c.warnings.push(`state "${stateQ}" not found; venue saved without state`);
  }
  const id = await create(c.o, "res.partner", vals);
  await auditM(c, "venue.created", "res.partner", id, undefined, { name, city });
  return { id, name, created: true };
}

async function ensureTrackLocation(c: Ctx, venueName: string): Promise<number | null> {
  try {
    const found = await c.o.call<any[]>("event.track.location", "search_read", { domain: [["name", "=ilike", venueName]], fields: ["id"], limit: 1 });
    if (found.length) return found[0].id;
    const id = await create(c.o, "event.track.location", { name: venueName });
    await auditM(c, "track_location.created", "event.track.location", id, undefined, { name: venueName });
    return id;
  } catch (e) {
    c.warnings.push(`track location not set: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// ---------------- sub-steps ----------------

const TICKET_DEFS = {
  ga: { name: "General Admission", description: "Free general admission." },
  pay_at_door: { name: "Pay At Door", description: "Register free online. Pay at the door." },
  volunteer: { name: "Volunteer", description: "Volunteer check-in." },
  staff: { name: "Staff", description: "Staff / crew check-in." },
} as const;
type TicketKind = keyof typeof TICKET_DEFS;

function classifyTicket(name: string): TicketKind | "other" {
  const n = name.toLowerCase();
  if (n.includes("vip")) return "other";
  if (n.includes("door")) return "pay_at_door";
  if (n === "ga" || n.includes("general")) return "ga";
  if (n.includes("volunteer")) return "volunteer";
  if (n.includes("staff")) return "staff";
  return "other";
}

async function syncTickets(c: Ctx, eventId: number, capacity: number, flags: { pay_at_door: boolean; volunteer: boolean; staff: boolean }, creating: boolean) {
  const tickets = await c.o.call<any[]>("event.event.ticket", "search_read", {
    domain: [["event_id", "=", eventId]], fields: ["id", "name", "product_id", "seats_taken", "seats_reserved", "seats_used"],
  });
  const productId = m2oId(tickets[0]?.product_id) ?? Number(c.env.ODOO_TICKET_PRODUCT_ID || 36);
  const want: Record<TicketKind, boolean> = { ga: true, ...flags };
  const kept: Record<string, number> = {};
  const removed: string[] = [];
  for (const t of tickets) {
    const kind = classifyTicket(String(t.name));
    if (kind !== "other" && want[kind] && kept[kind] === undefined) {
      await c.o.call("event.event.ticket", "write", { ids: [t.id], vals: { name: TICKET_DEFS[kind].name, description: TICKET_DEFS[kind].description, price: 0, seats_max: capacity } });
      kept[kind] = t.id;
      continue;
    }
    const used = (t.seats_taken ?? 0) + (t.seats_reserved ?? 0) + (t.seats_used ?? 0);
    if (!creating && used > 0) {
      // Has registrations: never delete, just close sales.
      await c.o.call("event.event.ticket", "write", { ids: [t.id], vals: { end_sale_datetime: toOdooUtc(new Date()) } });
      removed.push(`${t.name} (sales closed, has registrations)`);
    } else {
      await c.o.call("event.event.ticket", "unlink", { ids: [t.id] });
      removed.push(String(t.name));
    }
  }
  for (const kind of Object.keys(want) as TicketKind[]) {
    if (!want[kind] || kept[kind] !== undefined) continue;
    kept[kind] = await create(c.o, "event.event.ticket", {
      event_id: eventId, name: TICKET_DEFS[kind].name, description: TICKET_DEFS[kind].description, price: 0, product_id: productId, seats_max: capacity,
    });
  }
  const result = { kept: Object.fromEntries(Object.entries(kept).map(([k, v]) => [TICKET_DEFS[k as TicketKind].name, v])), removed };
  await auditM(c, "tickets.synced", "event.event.ticket", undefined, eventId, result);
  return result;
}

async function ensureSponsor(c: Ctx, eventId: number, templateId: number) {
  const partnerId = Number(c.env.PJ_SPONSOR_PARTNER_ID || 20);
  const typeId = Number(c.env.PJ_SPONSOR_TYPE_ID || 4);
  const have = await c.o.call<number>("event.sponsor", "search_count", { domain: [["event_id", "=", eventId], ["partner_id", "=", partnerId]] });
  if (have > 0) return { status: "present" };
  // Prefer copying the template's sponsor record (keeps logo, url, description); fall back to a fresh one.
  const tpl = await c.o.call<any[]>("event.sponsor", "search_read", {
    domain: [["event_id", "=", templateId], ["partner_id", "=", partnerId]], fields: ["id"], limit: 1,
  });
  let id: number;
  if (tpl.length) {
    const r = await c.o.call<number[] | number>("event.sponsor", "copy", { ids: [tpl[0].id], default: { event_id: eventId } });
    id = Array.isArray(r) ? r[0] : r;
  } else {
    id = await create(c.o, "event.sponsor", { event_id: eventId, partner_id: partnerId, sponsor_type_id: typeId, exhibitor_type: "sponsor", is_published: true });
  }
  await auditM(c, "sponsor.added", "event.sponsor", id, eventId, { partner_id: partnerId });
  return { status: "created", id };
}

async function addTrack(c: Ctx, eventId: number, n: { speaker?: SpeakerInput; tz: string; dateBegin: string; dateEnd: string; locationId: number | null; fallbackName: string }) {
  const sp = n.speaker;
  const begin = sp?.start ? parseEventDate(sp.start, n.tz, "speaker.start") : n.dateBegin;
  const end = sp?.end ? parseEventDate(sp.end, n.tz, "speaker.end") : n.dateEnd;
  if (end <= begin) throw new HttpError(400, "speaker.end must be after speaker.start", "invalid_input");
  const hours = (Date.parse(end.replace(" ", "T") + "Z") - Date.parse(begin.replace(" ", "T") + "Z")) / 3600000;
  const vals: Record<string, unknown> = {
    event_id: eventId,
    name: str(sp?.title, 200) || str(sp?.name, 200) || n.fallbackName,
    date: begin,
    duration: Math.round(hours * 100) / 100,
    is_published: true,
  };
  if (sp?.name) vals.partner_name = str(sp.name, 200);
  if (sp?.email) vals.partner_email = str(sp.email, 200);
  if (sp?.bio) vals.partner_biography = textToHtml(String(sp.bio).slice(0, 5000));
  if (n.locationId) vals.location_id = n.locationId;
  const id = await create(c.o, "event.track", vals);
  await auditM(c, "speaker.added", "event.track", id, eventId, { name: vals.name, partner_name: vals.partner_name ?? null, date: begin, duration: vals.duration });
  return { id, name: vals.name, date_utc: begin, duration_hours: vals.duration };
}

async function setImage(c: Ctx, eventId: number, img: { b64: string; mimetype: string; filename: string }) {
  const attId = await create(c.o, "ir.attachment", {
    name: img.filename, datas: img.b64, mimetype: img.mimetype, public: true, res_model: "event.event", res_id: eventId,
  });
  const ev = await c.o.call<any[]>("event.event", "search_read", { domain: [["id", "=", eventId]], fields: ["cover_properties"], context: { active_test: false } });
  let cover: Record<string, unknown> = {};
  try { cover = JSON.parse(ev[0]?.cover_properties || "{}"); } catch { cover = {}; }
  cover["background-image"] = `url('/web/image/${attId}/${encodeURIComponent(img.filename)}')`;
  if (!cover.resize_class) cover.resize_class = "o_record_has_cover o_half_screen_height";
  if (cover.opacity === undefined) cover.opacity = "0.4";
  await c.o.call("event.event", "write", { ids: [eventId], vals: { cover_properties: JSON.stringify(cover) } });
  await auditM(c, "image.uploaded", "ir.attachment", attId, eventId, { filename: img.filename, mimetype: img.mimetype });
  return { attachment_id: attId };
}

async function setPublished(c: Ctx, eventId: number, published: boolean) {
  await c.o.call("event.event", "write", { ids: [eventId], vals: { website_published: published } });
  await auditM(c, published ? "event.published" : "event.unpublished", "event.event", eventId, eventId);
}

async function archiveInOdoo(o: OdooClient, eventId: number) {
  try {
    await o.call("event.event", "action_archive", { ids: [eventId] });
  } catch {
    await o.call("event.event", "write", { ids: [eventId], vals: { active: false } });
  }
}

// ---------------- public operations ----------------

export async function createEvent(env: Env, req: Request, org: Organizer, body: EventInput) {
  const n = normalizeInput(body, { creating: true });
  const c: Ctx = { env, req, org, o: odoo(env), warnings: [] };
  const templateId = Number(env.ODOO_TEMPLATE_EVENT_ID || 14);

  // Everything that can fail on bad input is resolved BEFORE the copy.
  const site = await resolveWebsite(c, n.websiteId!);
  const tagIds = n.tags ? await resolveTagIds(c, n.tags) : null;
  const venue = n.venue ? await resolveVenue(c, n.venue) : null;

  const copied = await c.o.call<number[] | number>("event.event", "copy", {
    ids: [templateId], default: { name: n.name, website_published: false },
  });
  const eventId = Array.isArray(copied) ? copied[0] : copied;
  if (!eventId) throw new HttpError(502, "Odoo did not return the new event id", "odoo_error");

  // Ownership FIRST so the organizer can always see/fix/archive what was created.
  await env.DB.prepare("INSERT INTO organizer_events (organizer_id, odoo_event_id, website_id) VALUES (?, ?, ?)")
    .bind(org.id, eventId, site.websiteId)
    .run();
  await auditM(c, "event.created", "event.event", eventId, eventId, { template_id: templateId, name: n.name, website_id: site.websiteId });

  try {
    const vals: Record<string, unknown> = {
      name: n.name,
      date_begin: n.dateBegin,
      date_end: n.dateEnd,
      date_tz: n.tz,
      website_id: site.websiteId,
      company_id: site.companyId,
      seats_limited: true,
      seats_max: n.capacity,
    };
    if (n.subtitle) vals.subtitle = n.subtitle;
    if (n.descriptionHtml !== undefined) vals.description = n.descriptionHtml;
    if (tagIds) vals.tag_ids = [[6, 0, tagIds]];
    if (venue) vals.address_id = venue.id;
    if (org.odoo_partner_id) vals.organizer_id = org.odoo_partner_id;
    await c.o.call("event.event", "write", { ids: [eventId], vals });
    await auditM(c, "event.updated", "event.event", eventId, eventId, { fields: Object.keys(vals) });

    const tickets = await syncTickets(c, eventId, n.capacity!, n.tickets!, true);
    const sponsor = await ensureSponsor(c, eventId, templateId);
    const locationId = venue ? await ensureTrackLocation(c, venue.name) : null;
    const track = await addTrack(c, eventId, { speaker: n.speaker, tz: n.tz, dateBegin: n.dateBegin!, dateEnd: n.dateEnd!, locationId, fallbackName: "Main Event" });

    let image: unknown = null;
    if (n.image) {
      try { image = await setImage(c, eventId, n.image); } catch (e) { c.warnings.push(`image not saved: ${e instanceof Error ? e.message : String(e)}`); }
    }
    if (n.publish) await setPublished(c, eventId, true);

    return { ok: true, odoo_event_id: eventId, venue, tickets, sponsor, track, image, published: !!n.publish, warnings: c.warnings, event: await eventSummary(env, eventId) };
  } catch (e) {
    // Roll back by ARCHIVING (never deleting) the half-built copy.
    await archiveInOdoo(c.o, eventId).catch(() => undefined);
    await env.DB.prepare("UPDATE organizer_events SET status = 'archived' WHERE organizer_id = ? AND odoo_event_id = ?").bind(org.id, eventId).run();
    const msg = e instanceof Error ? e.message : String(e);
    await auditM(c, "event.create_failed", "event.event", eventId, eventId, { error: msg.slice(0, 300) });
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, `Event setup failed and the partial copy (${eventId}) was archived: ${msg.slice(0, 300)}`, e instanceof OdooError ? "odoo_error" : "error");
  }
}

export async function updateEvent(env: Env, req: Request, org: Organizer, eventId: number, body: EventInput) {
  await requireOwnership(env, org.id, eventId);
  const c: Ctx = { env, req, org, o: odoo(env), warnings: [] };
  const cur = await c.o.call<any[]>("event.event", "search_read", {
    domain: [["id", "=", eventId]], fields: ["date_tz", "date_begin", "date_end", "seats_max", "address_id"], context: { active_test: false },
  });
  if (!cur.length) throw new HttpError(404, "Event not found in Odoo", "not_found");
  const n = normalizeInput(body, { creating: false, currentTz: cur[0].date_tz });
  const begin = n.dateBegin ?? cur[0].date_begin;
  const end = n.dateEnd ?? cur[0].date_end;
  if (end <= begin) throw new HttpError(400, "end must be after start", "invalid_input");

  const vals: Record<string, unknown> = {};
  if (n.name) vals.name = n.name;
  if (n.subtitle) vals.subtitle = n.subtitle;
  if (n.descriptionHtml !== undefined) vals.description = n.descriptionHtml;
  if (body.timezone !== undefined) vals.date_tz = n.tz;
  if (n.dateBegin) vals.date_begin = n.dateBegin;
  if (n.dateEnd) vals.date_end = n.dateEnd;
  if (n.capacity !== undefined) Object.assign(vals, { seats_limited: true, seats_max: n.capacity });
  if (body.website_id !== undefined) {
    const site = await resolveWebsite(c, n.websiteId!);
    Object.assign(vals, { website_id: site.websiteId, company_id: site.companyId });
    await env.DB.prepare("UPDATE organizer_events SET website_id = ? WHERE organizer_id = ? AND odoo_event_id = ?").bind(site.websiteId, org.id, eventId).run();
  }
  if (n.tags) vals.tag_ids = [[6, 0, await resolveTagIds(c, n.tags)]];
  let venue = null;
  if (n.venue) { venue = await resolveVenue(c, n.venue); vals.address_id = venue.id; }
  if (Object.keys(vals).length) {
    await c.o.call("event.event", "write", { ids: [eventId], vals });
    await auditM(c, "event.updated", "event.event", eventId, eventId, { fields: Object.keys(vals) });
  }
  let tickets = null;
  if (n.tickets || n.capacity !== undefined) {
    const flags = n.tickets ?? (await currentTicketFlags(c, eventId));
    tickets = await syncTickets(c, eventId, n.capacity ?? cur[0].seats_max, flags, false);
  }
  let track = null;
  if (n.speaker) {
    const locName = venue?.name ?? (Array.isArray(cur[0].address_id) ? cur[0].address_id[1] : null);
    const locationId = locName ? await ensureTrackLocation(c, locName) : null;
    track = await addTrack(c, eventId, { speaker: n.speaker, tz: n.tz, dateBegin: begin, dateEnd: end, locationId, fallbackName: "Main Event" });
  }
  let image = null;
  if (n.image) image = await setImage(c, eventId, n.image);
  if (n.publish !== undefined) await setPublished(c, eventId, n.publish);
  return { ok: true, odoo_event_id: eventId, updated_fields: Object.keys(vals), venue, tickets, track, image, warnings: c.warnings, event: await eventSummary(env, eventId) };
}

async function currentTicketFlags(c: Ctx, eventId: number) {
  const t = await c.o.call<any[]>("event.event.ticket", "search_read", { domain: [["event_id", "=", eventId]], fields: ["name"] });
  const kinds = new Set(t.map((x) => classifyTicket(String(x.name))));
  return { pay_at_door: kinds.has("pay_at_door"), volunteer: kinds.has("volunteer"), staff: kinds.has("staff") };
}

export async function archiveEvent(env: Env, req: Request, org: Organizer, eventId: number) {
  await requireOwnership(env, org.id, eventId);
  const o = odoo(env);
  // Unpublish first so an archived event can never resurface on the website, then archive (never delete).
  await o.call("event.event", "write", { ids: [eventId], vals: { website_published: false } });
  await archiveInOdoo(o, eventId);
  await env.DB.prepare("UPDATE organizer_events SET status = 'archived' WHERE organizer_id = ? AND odoo_event_id = ?").bind(org.id, eventId).run();
  await audit(env, { organizerId: org.id, action: "event.archived", odooModel: "event.event", odooId: eventId, odooEventId: eventId, ip: clientIp(req) });
  return { ok: true, odoo_event_id: eventId, archived: true, published: false };
}

export async function publishEvent(env: Env, req: Request, org: Organizer, eventId: number, published: boolean) {
  await requireOwnership(env, org.id, eventId);
  const c: Ctx = { env, req, org, o: odoo(env), warnings: [] };
  await setPublished(c, eventId, published);
  return { ok: true, odoo_event_id: eventId, published };
}

const SUMMARY_FIELDS = [
  "id", "name", "active", "date_begin", "date_end", "date_tz", "seats_limited", "seats_max", "seats_available", "seats_taken",
  "address_id", "website_id", "company_id", "website_published", "website_url", "tag_ids", "stage_id", "organizer_id",
];

export async function eventSummary(env: Env, eventId: number) {
  const o = odoo(env);
  const ev = await o.call<any[]>("event.event", "search_read", { domain: [["id", "=", eventId]], fields: SUMMARY_FIELDS, context: { active_test: false } });
  if (!ev.length) return null;
  const e = ev[0];
  const [tickets, tracks, sponsors, regs] = await Promise.all([
    o.call<any[]>("event.event.ticket", "search_read", { domain: [["event_id", "=", eventId]], fields: ["id", "name", "price", "seats_max", "seats_taken"] }),
    o.call<any[]>("event.track", "search_read", { domain: [["event_id", "=", eventId]], fields: ["id", "name", "partner_name", "date", "duration", "location_id", "is_published"] }),
    o.call<any[]>("event.sponsor", "search_read", { domain: [["event_id", "=", eventId]], fields: ["id", "name", "partner_id", "sponsor_type_id"] }),
    Promise.all(
      ["draft", "open", "done", "cancel"].map(async (st) => [st, await o.call<number>("event.registration", "search_count", { domain: [["event_id", "=", eventId], ["state", "=", st]] })] as const),
    ),
  ]);
  const site = (typeof env.PUBLIC_SITE_BY_WEBSITE === "string" ? JSON.parse(env.PUBLIC_SITE_BY_WEBSITE) : null) ?? { "1": "https://www.patronjourney.com", "2": "https://www.pjrny.com" };
  const wid = m2oId(e.website_id);
  return {
    ...e,
    local_start: odooUtcToLocal(e.date_begin, e.date_tz),
    local_end: odooUtcToLocal(e.date_end, e.date_tz),
    public_url: wid && site[String(wid)] && e.website_url ? site[String(wid)] + e.website_url : null,
    odoo_backend_url: `${env.ODOO_URL.replace(/\/+$/, "")}/odoo/events/${eventId}`,
    tickets,
    tracks,
    sponsors,
    registrations_by_state: Object.fromEntries(regs),
  };
}

export async function listEvents(env: Env, org: Organizer) {
  const rows = await env.DB.prepare("SELECT odoo_event_id, website_id, status, created_at FROM organizer_events WHERE organizer_id = ? ORDER BY created_at DESC")
    .bind(org.id)
    .all<{ odoo_event_id: number; website_id: number; status: string; created_at: string }>();
  const ids = rows.results.map((r) => r.odoo_event_id);
  if (!ids.length) return { ok: true, events: [] };
  const ev = await odoo(env).call<any[]>("event.event", "search_read", {
    domain: [["id", "in", ids]], fields: ["id", "name", "active", "date_begin", "date_end", "date_tz", "seats_max", "seats_taken", "website_published", "website_url", "address_id"], context: { active_test: false },
  });
  const byId = new Map(ev.map((e) => [e.id, e]));
  return {
    ok: true,
    events: rows.results.map((r) => {
      const e = byId.get(r.odoo_event_id);
      return { ...r, odoo: e ? { ...e, local_start: odooUtcToLocal(e.date_begin, e.date_tz) } : null };
    }),
  };
}
