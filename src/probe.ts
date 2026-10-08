// Read-only Odoo discovery used to map real field names before building create/edit flows.
// Plus an opt-in write probe that copies the template into ONE disposable, unpublished,
// archived event named "PJ Organizer API Probe".
import type { Env } from "./env";
import { odoo, odooVersion, OdooError, type OdooClient } from "./odoo";

/** Fields we expect to use per model. The probe reports which exist and their real types. */
export const EXPECTED_FIELDS: Record<string, string[]> = {
  "event.event": [
    "name", "active", "date_begin", "date_end", "date_tz", "seats_limited", "seats_max", "seats_available",
    "seats_reserved", "seats_used", "seats_taken", "address_id", "organizer_id", "user_id", "company_id",
    "website_id", "is_published", "website_published", "website_menu", "tag_ids", "event_type_id",
    "event_ticket_ids", "registration_ids", "track_ids", "sponsor_ids", "event_booth_ids", "event_mail_ids",
    "description", "subtitle", "note", "ticket_instructions", "cover_properties", "stage_id", "lang",
    "event_registrations_open", "is_finished", "website_url", "event_url", "badge_format",
  ],
  "event.event.ticket": [
    "name", "event_id", "description", "price", "product_id", "seats_limited", "seats_max", "seats_available",
    "seats_reserved", "seats_used", "seats_taken", "start_sale_datetime", "end_sale_datetime", "sale_available",
    "is_expired", "sequence",
  ],
  "event.registration": [
    "name", "email", "phone", "partner_id", "event_id", "event_ticket_id", "state", "barcode", "date_closed",
    "company_name", "sale_order_id", "registration_answer_ids", "create_date",
  ],
  "event.track": [
    "name", "event_id", "partner_id", "partner_name", "partner_email", "partner_function", "partner_biography",
    "date", "date_end", "duration", "location_id", "stage_id", "is_published", "website_published", "tag_ids",
    "description", "website_image",
  ],
  "event.booth": [
    "name", "event_id", "booth_category_id", "state", "partner_id", "contact_name", "contact_email",
    "contact_phone", "description",
  ],
  "event.sponsor": [
    "name", "event_id", "partner_id", "sponsor_type_id", "url", "email", "is_published", "website_published",
    "exhibitor_type", "sequence",
  ],
  "event.type": ["name", "event_type_ticket_ids", "event_type_mail_ids", "tag_ids", "seats_limited", "seats_max"],
  "event.tag": ["name", "category_id", "color"],
  "event.tag.category": ["name", "tag_ids"],
  "res.partner": [
    "name", "email", "phone", "street", "street2", "city", "state_id", "zip", "country_id", "type", "is_company",
    "parent_id", "website_id", "user_ids", "active",
  ],
  website: ["name", "domain", "company_id", "default_lang_id"],
};

const FIELD_ATTRS = ["string", "type", "relation", "required", "readonly", "selection"];

async function step<T>(fn: () => Promise<T>): Promise<{ ok: true; result: T } | { ok: false; status?: number; error: string; odoo_exception?: string }> {
  try {
    return { ok: true, result: await fn() };
  } catch (e) {
    if (e instanceof OdooError) return { ok: false, status: e.status, error: e.message, odoo_exception: e.odooName };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type FieldsGet = Record<string, { string: string; type: string; relation?: string; required?: boolean; readonly?: boolean; selection?: [string, string][] }>;

async function fieldMap(o: OdooClient, model: string, full: boolean) {
  const fg = await o.call<FieldsGet>(model, "fields_get", { attributes: FIELD_ATTRS });
  const expected = EXPECTED_FIELDS[model] ?? [];
  const pickNames = full ? Object.keys(fg).sort() : expected.filter((f) => f in fg);
  const fields: Record<string, string> = {};
  const selections: Record<string, string[]> = {};
  for (const f of pickNames) {
    const d = fg[f];
    fields[f] = `${d.type}${d.relation ? `:${d.relation}` : ""}${d.required ? " (required)" : ""}${d.readonly ? " (readonly)" : ""}`;
    if (d.type === "selection" && Array.isArray(d.selection)) selections[f] = d.selection.map((s) => s[0]);
  }
  return {
    total_fields: Object.keys(fg).length,
    fields,
    selections,
    missing_expected: expected.filter((f) => !(f in fg)),
    _existing: new Set(Object.keys(fg)),
  };
}

export async function runReadProbe(env: Env, opts: { full?: boolean } = {}) {
  const templateId = Number(env.ODOO_TEMPLATE_EVENT_ID || 14);
  const out: Record<string, unknown> = {
    odoo_url: env.ODOO_URL,
    template_event_id: templateId,
    version: await odooVersion(env).catch((e) => ({ error: String(e) })),
  };

  let o: OdooClient;
  try {
    o = odoo(env);
  } catch (e) {
    out.api = { allowed: false, reason: e instanceof Error ? e.message : String(e) };
    return out;
  }
  out.key_binding_name = o.keyName;

  // 1) Auth + plan check: smallest possible authenticated call.
  const ctx = await step(() => o.call<Record<string, unknown>>("res.users", "context_get", {}));
  if (!ctx.ok) {
    out.api = {
      allowed: false,
      status: ctx.status,
      error: ctx.error,
      odoo_exception: ctx.odoo_exception,
      hint:
        ctx.status === 401
          ? "Key rejected (wrong/expired key, or key belongs to another database)."
          : ctx.status === 403
            ? "Authenticated but forbidden - on Odoo Online this usually means the plan lacks external API (Custom plan required)."
            : "See error.",
    };
    return out;
  }
  out.api = { allowed: true, context: { lang: ctx.result.lang, tz: ctx.result.tz, uid: ctx.result.uid } };

  // 2) Field maps.
  const maps: Record<string, unknown> = {};
  const existing: Record<string, Set<string>> = {};
  for (const model of Object.keys(EXPECTED_FIELDS)) {
    const r = await step(() => fieldMap(o, model, !!opts.full));
    if (r.ok) {
      const { _existing, ...rest } = r.result;
      existing[model] = _existing;
      maps[model] = rest;
    } else {
      maps[model] = { error: r.error, status: r.status };
    }
  }
  out.field_map = maps;

  const has = (model: string, f: string) => existing[model]?.has(f) ?? false;
  const fieldsFor = (model: string, wanted: string[]) => wanted.filter((f) => has(model, f));

  // 3) Template (Testival) summary.
  const evFields = fieldsFor("event.event", EXPECTED_FIELDS["event.event"].filter((f) => !["registration_ids", "description", "cover_properties"].includes(f)));
  const ev = await step(() =>
    o.call<any[]>("event.event", "search_read", {
      domain: [["id", "=", templateId]],
      fields: evFields,
      context: { active_test: false },
    }),
  );
  const summary: Record<string, unknown> = { event: ev.ok ? ev.result[0] ?? null : ev };

  const children: [string, string, string[]][] = [
    ["tickets", "event.event.ticket", ["name", "price", "seats_limited", "seats_max", "seats_available", "product_id", "start_sale_datetime", "end_sale_datetime"]],
    ["tracks", "event.track", ["name", "partner_id", "partner_name", "date", "date_end", "duration", "stage_id", "is_published", "website_published"]],
    ["booths", "event.booth", ["name", "booth_category_id", "state", "partner_id"]],
    ["sponsors", "event.sponsor", ["name", "partner_id", "sponsor_type_id", "is_published", "website_published", "exhibitor_type"]],
    ["mail_schedulers", "event.mail", ["template_ref", "interval_nbr", "interval_unit", "interval_type", "notification_type"]],
  ];
  for (const [label, model, wanted] of children) {
    if (!existing[model] && model !== "event.mail") {
      summary[label] = { error: "model not available" };
      continue;
    }
    const r = await step(() =>
      o.call<any[]>(model, "search_read", {
        domain: [["event_id", "=", templateId]],
        fields: model === "event.mail" ? wanted : fieldsFor(model, wanted),
        limit: 50,
      }),
    );
    summary[label] = r.ok ? r.result : r;
  }
  const regStates = ["draft", "open", "done", "cancel"];
  const regCounts: Record<string, unknown> = {};
  for (const s of regStates) {
    const r = await step(() => o.call<number>("event.registration", "search_count", { domain: [["event_id", "=", templateId], ["state", "=", s]] }));
    regCounts[s] = r.ok ? r.result : r.error;
  }
  summary.registration_counts_by_state = regCounts;
  out.template_summary = summary;

  // 4) Reference data the create-event flow needs.
  const websites = await step(() => o.call<any[]>("website", "search_read", { domain: [], fields: fieldsFor("website", ["name", "domain", "company_id"]) }));
  out.websites = websites.ok ? websites.result : websites;
  const types = await step(() => o.call<any[]>("event.type", "search_read", { domain: [], fields: ["name"], limit: 50 }));
  out.event_templates = types.ok ? types.result : types;
  const tags = await step(() => o.call<any[]>("event.tag", "search_read", { domain: [], fields: fieldsFor("event.tag", ["name", "category_id"]), limit: 200 }));
  out.event_tags = tags.ok ? tags.result : tags;

  return out;
}

export const PROBE_EVENT_NAME = "PJ Organizer API Probe";

/** Copies the template ONCE into an unpublished event, reports what the copy carried over, then archives it. */
export async function runWriteProbe(env: Env) {
  const o = odoo(env);
  const templateId = Number(env.ODOO_TEMPLATE_EVENT_ID || 14);

  const existing = await o.call<any[]>("event.event", "search_read", {
    domain: [["name", "=", PROBE_EVENT_NAME]],
    fields: ["id", "active"],
    context: { active_test: false },
  });
  if (existing.length) return { reused: true, probe_event: existing[0], note: "Probe event already exists; not creating another." };

  const fg = await o.call<Record<string, unknown>>("event.event", "fields_get", { attributes: ["type"] });
  const copied = await o.call<number[] | number>("event.event", "copy", { ids: [templateId], default: { name: PROBE_EVENT_NAME } });
  const newId = Array.isArray(copied) ? copied[0] : copied;

  const vals: Record<string, unknown> = {};
  if ("is_published" in fg) vals.is_published = false;
  if (Object.keys(vals).length) await o.call("event.event", "write", { ids: [newId], vals });

  const countBy = async (model: string, eventId: number) =>
    o.call<number>(model, "search_count", { domain: [["event_id", "=", eventId]] }).catch(() => null);
  const carried: Record<string, { template: number | null; copy: number | null }> = {};
  for (const m of ["event.event.ticket", "event.track", "event.sponsor", "event.booth", "event.mail"]) {
    carried[m] = { template: await countBy(m, templateId), copy: await countBy(m, newId) };
  }

  let archived = false;
  try {
    await o.call("event.event", "action_archive", { ids: [newId] });
    archived = true;
  } catch {
    try {
      await o.call("event.event", "write", { ids: [newId], vals: { active: false } });
      archived = true;
    } catch {
      archived = false;
    }
  }
  return { reused: false, probe_event_id: newId, archived, unpublished: vals.is_published === false, copy_carried_over: carried };
}
