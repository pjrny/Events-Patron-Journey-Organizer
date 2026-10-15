// Simulator link: event-draft.v1 payloads from the Festival Forecaster -> Odoo events via the existing create path.
// See docs/EVENT_DRAFT.md and docs/event-draft.v1.schema.json.
import type { Env } from "./env";
import { HttpError, clientIp } from "./http";
import { randomToken, sha256Hex, timingSafeEqual } from "./crypto";
import { audit } from "./db";
import { createEvent, normalizeInput, eventSummary, type EventInput } from "./events";
import { isValidTz } from "./time";
import { odoo } from "./odoo";
import type { Organizer } from "./auth";
import { baseUrl } from "./auth";

export const DRAFT_VERSION = "event-draft.v1";
export const MAX_DRAFT_BYTES = 1024 * 1024; // ~1 MB request cap
const ANON_TTL_DAYS = 7;
const ANON_PER_IP_PER_HOUR = 30;
const MAX_TICKETS = 10;
const MAX_LINEUP = 100;
const MAX_TAGS = 15;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface DraftV1 {
  version: typeof DRAFT_VERSION;
  name: string;
  start: string;
  end: string;
  timezone: string;
  venue: { name: string; street?: string; city?: string; state?: string; zip?: string };
  capacity: number;
  description?: string;
  tags?: string[];
  image?: string; // data URL / raw base64, or https URL
  tickets?: { name: string; price?: number; max?: number }[];
  lineup?: { name: string; start: string; end: string }[];
  forecast?: Record<string, unknown>;
}

const bad = (msg: string, field?: string) => new HttpError(400, field ? `${field}: ${msg}` : msg, "invalid_draft");
const s = (v: unknown, field: string, max: number, required = false): string | undefined => {
  if (v === undefined || v === null || v === "") {
    if (required) throw bad("is required", field);
    return undefined;
  }
  if (typeof v !== "string") throw bad("must be a string", field);
  const t = v.trim();
  if (required && !t) throw bad("is required", field);
  if (t.length > max) throw bad(`must be at most ${max} characters`, field);
  return t || undefined;
};
const ALLOWED_KEYS = new Set(["version", "name", "start", "end", "timezone", "venue", "capacity", "description", "tags", "image", "tickets", "lineup", "forecast", "$schema"]);
const OWNER_KEYS = ["owner", "owner_id", "organizer", "organizer_id", "organizer_email", "email", "odoo_partner_id", "user_id"];

/** Strict server-side validation. Returns a normalized draft or throws 400 invalid_draft with a field-specific message. */
export function validateDraft(raw: unknown): DraftV1 {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad("Body must be a JSON object");
  const b = raw as Record<string, any>;
  for (const k of OWNER_KEYS) if (k in b) throw bad(`"${k}" is not allowed: the owner always comes from the signed-in session`);
  const unknown = Object.keys(b).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknown.length) throw bad(`unknown field(s): ${unknown.join(", ")}`);
  if (b.version !== DRAFT_VERSION) throw bad(`must be "${DRAFT_VERSION}"`, "version");

  const tz = s(b.timezone, "timezone", 64) ?? "America/Chicago";
  if (!isValidTz(tz)) throw bad("unknown IANA timezone", "timezone");
  const d: DraftV1 = {
    version: DRAFT_VERSION,
    name: s(b.name, "name", 200, true)!,
    start: s(b.start, "start", 40, true)!,
    end: s(b.end, "end", 40, true)!,
    timezone: tz,
    venue: { name: "" },
    capacity: 0,
  };
  if (!b.venue || typeof b.venue !== "object" || Array.isArray(b.venue)) throw bad("is required (object with name, street, city, state, zip)", "venue");
  d.venue = {
    name: s(b.venue.name, "venue.name", 200, true)!,
    street: s(b.venue.street, "venue.street", 200),
    city: s(b.venue.city, "venue.city", 100),
    state: s(b.venue.state, "venue.state", 60),
    zip: s(b.venue.zip, "venue.zip", 20),
  };
  const cap = Number(b.capacity);
  if (!Number.isInteger(cap) || cap < 1 || cap > 100000) throw bad("must be a whole number 1-100000", "capacity");
  d.capacity = cap;

  if (b.description !== undefined) d.description = s(b.description, "description", 20000);
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags)) throw bad("must be an array of strings", "tags");
    if (b.tags.length > MAX_TAGS) throw bad(`at most ${MAX_TAGS} tags`, "tags");
    d.tags = [...new Set(b.tags.map((t: unknown, i: number) => {
      const v = s(t, `tags[${i}]`, 40, true)!;
      if (!/^[\p{L}\p{N} &'\/+.-]+$/u.test(v)) throw bad("letters, numbers, spaces and & ' / + . - only", `tags[${i}]`);
      return v;
    }))] as string[];
  }
  if (b.image !== undefined && b.image !== null && b.image !== "") {
    const img = s(b.image, "image", 8 * 1024 * 1024)!;
    if (/^https:\/\//i.test(img)) {
      try { new URL(img); } catch { throw bad("is not a valid URL", "image"); }
    } else {
      const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,/i.exec(img);
      const b64 = img.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) throw bad("must be an https URL, a data:image/...;base64 URL, or raw base64", "image");
      if ((b64.length * 3) / 4 > MAX_IMAGE_BYTES) throw bad("is larger than 5 MB", "image");
      if (img.startsWith("data:") && !m) throw bad("must be png, jpeg, webp or gif", "image");
    }
    d.image = img;
  }
  if (b.tickets !== undefined) {
    if (!Array.isArray(b.tickets)) throw bad("must be an array", "tickets");
    if (b.tickets.length > MAX_TICKETS) throw bad(`at most ${MAX_TICKETS} ticket types`, "tickets");
    d.tickets = b.tickets.map((t: any, i: number) => {
      if (!t || typeof t !== "object") throw bad("must be an object {name, price, max}", `tickets[${i}]`);
      const price = t.price === undefined ? 0 : Number(t.price);
      if (!Number.isFinite(price) || price < 0) throw bad("must be a number >= 0", `tickets[${i}].price`);
      const max = t.max === undefined ? undefined : Number(t.max);
      if (max !== undefined && (!Number.isInteger(max) || max < 1)) throw bad("must be a whole number >= 1", `tickets[${i}].max`);
      return { name: s(t.name, `tickets[${i}].name`, 120, true)!, price, ...(max !== undefined ? { max } : {}) };
    });
  }
  if (b.lineup !== undefined) {
    if (!Array.isArray(b.lineup)) throw bad("must be an array", "lineup");
    if (b.lineup.length > MAX_LINEUP) throw bad(`at most ${MAX_LINEUP} acts`, "lineup");
    // Rows with a blank/missing name are skipped (simulator may send placeholder rows).
    const named = b.lineup.map((a: any, i: number) => [a, i] as const).filter(([a]: any) => !(a && typeof a === "object" && (a.name === undefined || a.name === null || (typeof a.name === "string" && !a.name.trim()))));
    d.lineup = named.map(([a, i]: any) => {
      if (!a || typeof a !== "object") throw bad("must be an object {name, start, end}", `lineup[${i}]`);
      return { name: s(a.name, `lineup[${i}].name`, 200, true)!, start: s(a.start, `lineup[${i}].start`, 40, true)!, end: s(a.end, `lineup[${i}].end`, 40, true)! };
    });
  }
  if (b.forecast !== undefined && b.forecast !== null) {
    if (typeof b.forecast !== "object" || Array.isArray(b.forecast)) throw bad("must be an object", "forecast");
    d.forecast = b.forecast;
  }

  // Run the same date/capacity rules as event creation so bad drafts fail at save time, not at Create.
  const input = toEventInput(d);
  try {
    const n = normalizeInput(input, { creating: true });
    for (const [i, a] of (d.lineup ?? []).entries()) {
      const st = normalizeInput({ ...input, start: a.start, end: a.end }, { creating: true });
      if (st.dateBegin! < n.dateBegin! || st.dateEnd! > n.dateEnd!) throw bad("set must fall inside the event start/end", `lineup[${i}]`);
    }
  } catch (e) {
    if (e instanceof HttpError && e.code !== "invalid_draft") throw new HttpError(400, e.message, "invalid_draft");
    throw e;
  }
  return d;
}

/** Maps a draft onto the existing EventInput (GA always created; tickets handled separately as custom tickets). */
export function toEventInput(d: DraftV1): EventInput {
  return {
    name: d.name,
    description: d.description,
    start: d.start,
    end: d.end,
    timezone: d.timezone,
    website_id: 1,
    venue: { ...d.venue, country: "US" },
    capacity: d.capacity,
    tickets: { pay_at_door: false, volunteer: false, staff: false },
  };
}

async function imageInput(d: DraftV1, warnings: string[]): Promise<EventInput["image"]> {
  if (!d.image) return undefined;
  if (/^https:\/\//i.test(d.image)) {
    try {
      const r = await fetch(d.image, { redirect: "follow", cf: { cacheTtl: 0 } } as RequestInit);
      const ct = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!r.ok || !/^image\/(png|jpe?g|webp|gif)$/.test(ct)) throw new Error(`HTTP ${r.status} ${ct || "no content-type"}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) throw new Error("larger than 5 MB");
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { data_base64: btoa(bin), mimetype: ct, filename: `flyer.${ct.split("/")[1].replace("jpeg", "jpg")}` };
    } catch (e) {
      warnings.push(`image URL not imported: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  }
  const m = /^data:(image\/[a-z]+);base64,/i.exec(d.image);
  return { data_base64: d.image, mimetype: (m?.[1] ?? "image/jpeg").toLowerCase() };
}

const newId = () => "drf_" + randomToken(12);

export async function readDraftBody(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_DRAFT_BYTES) throw new HttpError(413, "Draft is larger than 1 MB", "too_large");
  const text = await req.text();
  if (text.length > MAX_DRAFT_BYTES) throw new HttpError(413, "Draft is larger than 1 MB", "too_large");
  try { return JSON.parse(text); } catch { throw new HttpError(400, "Body must be JSON", "invalid_draft"); }
}

export async function saveAnonymousDraft(env: Env, req: Request, raw: unknown) {
  const ip = clientIp(req) ?? "unknown";
  const ipHash = await sha256Hex("draft-ip:" + ip);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM drafts WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')").bind(ipHash).first<{ n: number }>();
  if ((n?.n ?? 0) >= ANON_PER_IP_PER_HOUR) throw new HttpError(429, "Too many drafts from this network. Try again in an hour.", "rate_limited");
  const d = validateDraft(raw);
  const id = newId();
  const claim = randomToken(32);
  const exp = await env.DB.prepare(
    `INSERT INTO drafts (id, claim_token_hash, payload, ip_hash, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+${ANON_TTL_DAYS} days')) RETURNING expires_at`,
  ).bind(id, await sha256Hex(claim), JSON.stringify(d), ipHash).first<{ expires_at: string }>();
  await audit(env, { action: "draft.saved_anonymous", detail: { draft_id: id, name: d.name }, ip: clientIp(req) });
  return {
    ok: true, draft_id: id, claim_token: claim,
    expires_at: exp ? exp.expires_at.replace(" ", "T") + "Z" : null,
    claim_url: `${baseUrl(env, req)}/claim?draft=${encodeURIComponent(id)}&t=${encodeURIComponent(claim)}`,
  };
}

export async function saveOrganizerDraft(env: Env, req: Request, org: Organizer, raw: unknown) {
  const d = validateDraft(raw);
  const id = newId();
  await env.DB.prepare("INSERT INTO drafts (id, organizer_id, payload, claimed_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)").bind(id, org.id, JSON.stringify(d)).run();
  await audit(env, { organizerId: org.id, action: "draft.saved", detail: { draft_id: id, name: d.name }, ip: clientIp(req) });
  return { ok: true, draft_id: id };
}

interface DraftRow { id: string; organizer_id: number | null; claim_token_hash: string | null; payload: string; created_at: string; expires_at: string | null; claimed_at: string | null; created_event_id: number | null }

const publicDraft = (r: DraftRow) => ({
  draft_id: r.id, payload: JSON.parse(r.payload), created_at: r.created_at, claimed_at: r.claimed_at,
  created_event_id: r.created_event_id && r.created_event_id > 0 ? r.created_event_id : null,
});

export async function getOwnDraft(env: Env, org: Organizer, id: string) {
  const r = await env.DB.prepare("SELECT * FROM drafts WHERE id = ?").bind(id).first<DraftRow>();
  if (!r || r.organizer_id !== org.id) throw new HttpError(404, "Draft not found", "not_found");
  return r;
}
export async function getOwnDraftPublic(env: Env, org: Organizer, id: string) {
  return { ok: true, ...publicDraft(await getOwnDraft(env, org, id)) };
}

/** Checks an anonymous claim (draft exists, token hash matches, unclaimed, unexpired). Throws 400/404/410. */
export async function checkClaim(env: Env, draftId: unknown, token: unknown): Promise<DraftRow> {
  const id = typeof draftId === "string" ? draftId.trim() : "";
  const t = typeof token === "string" ? token.trim() : "";
  if (!id || !t || id.length > 64 || t.length > 200) throw new HttpError(400, "Missing draft id or claim token", "invalid_claim");
  const r = await env.DB.prepare("SELECT * FROM drafts WHERE id = ?").bind(id).first<DraftRow>();
  if (!r || !r.claim_token_hash || !timingSafeEqual(r.claim_token_hash, await sha256Hex(t))) throw new HttpError(404, "This draft link is invalid", "invalid_claim");
  if (r.organizer_id !== null) throw new HttpError(409, "This draft was already claimed. Sign in with the account that claimed it to see it in your dashboard.", "already_claimed");
  if (r.expires_at && Date.parse(r.expires_at.replace(" ", "T") + "Z") < Date.now()) throw new HttpError(410, "This draft expired (anonymous drafts are kept 7 days). Run the simulator again.", "expired");
  return r;
}

/** Attaches an anonymous draft to an organizer, atomically. Re-claiming one's own draft is a no-op. */
export async function attachDraft(env: Env, req: Request, org: Organizer, draftId: string, viaTokenCheck: boolean): Promise<DraftRow> {
  const r = await env.DB.prepare(
    `UPDATE drafts SET organizer_id = ?, claim_token_hash = NULL, expires_at = NULL, claimed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND organizer_id IS NULL AND (expires_at IS NULL OR expires_at > datetime('now')) RETURNING *`,
  ).bind(org.id, draftId).first<DraftRow>();
  if (r) {
    await audit(env, { organizerId: org.id, action: "draft.claimed", detail: { draft_id: draftId, via: viaTokenCheck ? "claim_token" : "sign_in_link" }, ip: clientIp(req) });
    return r;
  }
  const cur = await env.DB.prepare("SELECT * FROM drafts WHERE id = ?").bind(draftId).first<DraftRow>();
  if (cur && cur.organizer_id === org.id) return cur;
  throw new HttpError(409, "This draft could not be claimed (already claimed or expired)", "claim_failed");
}

export async function claimWithToken(env: Env, req: Request, org: Organizer, draftId: unknown, token: unknown) {
  const id = typeof draftId === "string" ? draftId.trim() : "";
  const mine = id ? await env.DB.prepare("SELECT * FROM drafts WHERE id = ? AND organizer_id = ?").bind(id, org.id).first<DraftRow>() : null;
  if (mine) return mine;
  const row = await checkClaim(env, draftId, token);
  return attachDraft(env, req, org, row.id, true);
}

/** Remembers a verified claim on a sign-in link row so the draft lands on whoever verifies that link. */
export async function linkDraftToAuthToken(env: Env, tokenHash: string, draftId: string) {
  await env.DB.prepare("INSERT OR REPLACE INTO auth_link_drafts (token_hash, draft_id) VALUES (?, ?)").bind(tokenHash, draftId).run();
}

/** After a sign-in link is verified: attach any draft it carried. Returns the draft id (or null). Never throws. */
export async function claimFromAuthToken(env: Env, req: Request, org: Organizer, tokenHash: string): Promise<string | null> {
  const row = await env.DB.prepare("DELETE FROM auth_link_drafts WHERE token_hash = ? RETURNING draft_id").bind(tokenHash).first<{ draft_id: string }>();
  if (!row) return null;
  try {
    await attachDraft(env, req, org, row.draft_id, false);
    return row.draft_id;
  } catch {
    return row.draft_id; // the claim page will show why (already claimed / expired)
  }
}

async function lightPublicUrl(env: Env, eventId: number): Promise<{ public_url: string | null }> {
  try {
    const rows = await odoo(env).call<any[]>("event.event", "search_read", { domain: [["id", "=", eventId]], fields: ["website_url", "website_id"], context: { active_test: false } });
    const e = rows[0];
    const site: Record<string, string> = { "1": "https://www.patronjourney.com", "2": "https://www.pjrny.com" };
    const wid = Array.isArray(e?.website_id) ? String(e.website_id[0]) : "";
    return { public_url: e?.website_url && site[wid] ? site[wid] + e.website_url : null };
  } catch {
    return { public_url: null };
  }
}

/** Create the Odoo event from an owned draft. Idempotent: a second call returns the same event. */
export async function createFromDraft(env: Env, req: Request, org: Organizer, id: string, opts: { publish?: boolean } = {}) {
  const r = await getOwnDraft(env, org, id);
  const base = baseUrl(env, req);
  const done = async (eventId: number, reused: boolean, extra: Record<string, unknown> = {}) => {
    // Reused path stays light (one Odoo read, failure-tolerant) so retries/double-clicks never trip Odoo rate limits.
    const summary = (extra.event as any) ?? (await lightPublicUrl(env, eventId));
    return {
      ok: true, reused, draft_id: id, odoo_event_id: eventId,
      dashboard_url: `${base}/dashboard?event=${eventId}`,
      public_url: summary?.public_url ?? null,
      ...extra,
    };
  };
  if (r.created_event_id && r.created_event_id > 0) return done(r.created_event_id, true);

  const lock = await env.DB.prepare("UPDATE drafts SET created_event_id = -1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organizer_id = ? AND created_event_id IS NULL RETURNING id")
    .bind(id, org.id).first();
  if (!lock) {
    const again = await getOwnDraft(env, org, id);
    if (again.created_event_id && again.created_event_id > 0) return done(again.created_event_id, true);
    throw new HttpError(409, "This event is being created right now. Try again in a few seconds.", "create_in_progress");
  }
  let copiedId: number | null = null;
  try {
    const d = validateDraft(JSON.parse(r.payload));
    const warnings: string[] = [];
    const input = toEventInput(d);
    input.image = await imageInput(d, warnings);
    input.publish = !!opts.publish;
    const res = await createEvent(env, req, org, input, {
      customTickets: (d.tickets ?? []).map((t) => ({ name: t.name })),
      lineup: d.lineup,
      defaultTrackName: d.name,
      freeTags: d.tags,
      onCopied: async (eid) => {
        copiedId = eid;
        await env.DB.prepare("UPDATE drafts SET created_event_id = ? WHERE id = ?").bind(eid, id).run();
      },
    });
    await audit(env, { organizerId: org.id, action: "draft.event_created", odooModel: "event.event", odooId: res.odoo_event_id, odooEventId: res.odoo_event_id, detail: { draft_id: id }, ip: clientIp(req) });
    return done(res.odoo_event_id, false, { published: res.published, tickets: res.tickets, track: res.track, warnings: [...warnings, ...res.warnings], event: res.event });
  } catch (e) {
    // createEvent archives a half-built copy itself; release the draft so the organizer can retry.
    await env.DB.prepare("UPDATE drafts SET created_event_id = NULL WHERE id = ?").bind(id).run();
    if (copiedId) await audit(env, { organizerId: org.id, action: "draft.create_failed", odooEventId: copiedId, detail: { draft_id: id }, ip: clientIp(req) });
    throw e;
  }
}
