// Ticket scanning + attendee list. Odoo event.registration is the source of truth.
//   Scan -> JWT (route gate) -> ownership on odoo_event_id (D1) -> registration by barcode
//   for THAT event only -> done? "Already Checked In" : cancel/missing? "Invalid Ticket" : set done -> "Checked In".
// Every attempt is written to audit_logs (action checkin.*).
import type { Env } from "./env";
import { HttpError, clientIp } from "./http";
import { odoo } from "./odoo";
import { audit, requireOwnership } from "./db";
import { odooUtcToLocal } from "./time";
import type { Organizer } from "./auth";

export type CheckinResult = "checked_in" | "already_checked_in" | "invalid_ticket";
const LABEL: Record<CheckinResult, string> = {
  checked_in: "Checked In",
  already_checked_in: "Already Checked In",
  invalid_ticket: "Invalid Ticket",
};

const REG_FIELDS = ["id", "name", "email", "partner_id", "event_id", "event_ticket_id", "state", "barcode", "active", "date_closed", "create_date"];
const STATE_LABEL: Record<string, string> = { draft: "Unconfirmed", open: "Registered", done: "Checked In", cancel: "Cancelled" };

/**
 * Accepts what a scanner may produce: the raw Odoo barcode (decimal string), or a URL / text that carries it.
 * Odoo tickets encode `event.registration.barcode` (random 64-bit decimal) in the QR code.
 */
export function normalizeBarcode(raw: unknown): string {
  let s = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!s) throw new HttpError(400, "barcode is required", "invalid_input");
  if (s.length > 512) throw new HttpError(400, "barcode is too long", "invalid_input");
  if (!/^\d{4,40}$/.test(s)) {
    try {
      const u = new URL(s);
      const q = u.searchParams.get("barcode") || u.searchParams.get("code");
      if (q) s = q.trim();
      else {
        const seg = u.pathname.split("/").filter(Boolean).reverse().find((p) => /^\d{4,40}$/.test(p));
        if (seg) s = seg;
      }
    } catch {
      const m = /(\d{8,40})/.exec(s);
      if (m) s = m[1];
    }
  }
  return s.slice(0, 64);
}

const m2oName = (v: unknown) => (Array.isArray(v) ? String(v[1]) : null);
const m2oId = (v: unknown) => (Array.isArray(v) ? Number(v[0]) : null);

function publicAttendee(r: any, tz?: string) {
  return {
    registration_id: r.id,
    name: r.name || null,
    email: r.email || null,
    partner_id: m2oId(r.partner_id),
    ticket: m2oName(r.event_ticket_id),
    ticket_id: m2oId(r.event_ticket_id),
    state: r.state,
    status: STATE_LABEL[r.state] ?? r.state,
    checked_in: r.state === "done",
    checked_in_at_utc: r.date_closed || null,
    checked_in_at_local: r.date_closed && tz ? odooUtcToLocal(r.date_closed, tz) : null,
    barcode: r.barcode || null,
    registered_at_utc: r.create_date || null,
  };
}

export async function checkIn(env: Env, req: Request, org: Organizer, eventId: number, rawBarcode: unknown) {
  await requireOwnership(env, org.id, eventId);
  const barcode = normalizeBarcode(rawBarcode);
  const o = odoo(env);
  const ip = clientIp(req);

  const rows = await o.call<any[]>("event.registration", "search_read", {
    domain: [["barcode", "=", barcode], ["event_id", "=", eventId]],
    fields: REG_FIELDS,
    limit: 1,
    context: { active_test: false },
  });
  const reg = rows[0];
  const ev = await o.call<any[]>("event.event", "search_read", { domain: [["id", "=", eventId]], fields: ["date_tz"], context: { active_test: false } });
  const tz = ev[0]?.date_tz || "America/Chicago";

  let result: CheckinResult;
  let reason: string | undefined;
  let method: string | undefined;
  if (!reg) { result = "invalid_ticket"; reason = "not_found_for_event"; }
  else if (reg.active === false) { result = "invalid_ticket"; reason = "registration_archived"; }
  else if (reg.state === "cancel") { result = "invalid_ticket"; reason = "cancelled"; }
  else if (reg.state === "done") { result = "already_checked_in"; }
  else {
    // Mark attended. Prefer Odoo's business method (logs "Attended on ..." in chatter), fall back to a plain write.
    try {
      await o.call("event.registration", "action_set_done", { ids: [reg.id] });
      method = "action_set_done";
    } catch {
      await o.call("event.registration", "write", { ids: [reg.id], vals: { state: "done" } });
      method = "write_state_done";
    }
    result = "checked_in";
  }

  let after = reg;
  if (reg && result === "checked_in") {
    const re = await o.call<any[]>("event.registration", "search_read", { domain: [["id", "=", reg.id]], fields: REG_FIELDS, context: { active_test: false } });
    after = re[0] ?? reg;
    if (after.state !== "done") throw new HttpError(502, "Odoo did not mark the registration attended", "odoo_error");
  }

  await audit(env, {
    organizerId: org.id,
    action: result === "checked_in" ? "checkin.performed" : result === "already_checked_in" ? "checkin.duplicate" : "checkin.invalid",
    odooModel: "event.registration",
    odooId: reg?.id,
    odooEventId: eventId,
    detail: { barcode, result, reason, method, prior_state: reg?.state ?? null },
    ip,
  });

  return {
    ok: result === "checked_in",
    result,
    message: LABEL[result],
    ...(reason ? { reason } : {}),
    ...(method ? { method } : {}),
    odoo_event_id: eventId,
    barcode,
    attendee: after ? publicAttendee(after, tz) : null,
  };
}

export async function listAttendees(env: Env, org: Organizer, eventId: number) {
  await requireOwnership(env, org.id, eventId);
  const o = odoo(env);
  const [ev, regs] = await Promise.all([
    o.call<any[]>("event.event", "search_read", { domain: [["id", "=", eventId]], fields: ["id", "name", "date_tz", "seats_max", "active", "website_published"], context: { active_test: false } }),
    o.call<any[]>("event.registration", "search_read", { domain: [["event_id", "=", eventId]], fields: REG_FIELDS, order: "id asc", limit: 5000 }),
  ]);
  if (!ev.length) throw new HttpError(404, "Event not found in Odoo", "not_found");
  const tz = ev[0].date_tz || "America/Chicago";
  const attendees = regs.map((r) => publicAttendee(r, tz));
  const live = attendees.filter((a) => a.state !== "cancel");
  const counts = {
    registered: live.length, // every non-cancelled registration (pending + checked in)
    checked_in: live.filter((a) => a.state === "done").length,
    pending: live.filter((a) => a.state === "open" || a.state === "draft").length,
    unconfirmed: live.filter((a) => a.state === "draft").length,
    cancelled: attendees.length - live.length,
  };
  return { ok: true, event: { id: ev[0].id, name: ev[0].name, timezone: tz, capacity: ev[0].seats_max, active: ev[0].active, published: ev[0].website_published }, counts, attendees };
}
