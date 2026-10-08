import type { Env } from "./env";
import { HttpError } from "./http";
import schemaSql from "../migrations/0001_init.sql";

let schemaReady = false;

/**
 * Idempotently applies migrations/0001_init.sql (all statements are CREATE ... IF NOT EXISTS).
 * Lets the Worker self-bootstrap D1 even when deployed from the dashboard/Git integration,
 * where `wrangler d1 migrations apply --remote` may not be available.
 */
export async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  const statements = schemaSql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  schemaReady = true;
}

export async function tableCounts(env: Env): Promise<Record<string, number>> {
  const tables = ["organizers", "organizer_events", "sessions", "magic_links", "login_attempts", "audit_logs"];
  const out: Record<string, number> = {};
  for (const t of tables) {
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>();
    out[t] = r?.n ?? 0;
  }
  return out;
}

/** Ownership gate. Every event-scoped request must pass through here. */
export async function requireOwnership(env: Env, organizerId: number, odooEventId: number) {
  const row = await env.DB.prepare(
    "SELECT id, website_id, status FROM organizer_events WHERE organizer_id = ? AND odoo_event_id = ?",
  )
    .bind(organizerId, odooEventId)
    .first<{ id: number; website_id: number | null; status: string }>();
  if (!row) throw new HttpError(403, "You do not own this event", "forbidden");
  return row;
}

export async function audit(
  env: Env,
  entry: {
    organizerId?: number | null;
    action: string;
    odooModel?: string;
    odooId?: number;
    odooEventId?: number;
    detail?: unknown;
    ip?: string | null;
  },
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO audit_logs (organizer_id, action, odoo_model, odoo_id, odoo_event_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      entry.organizerId ?? null,
      entry.action,
      entry.odooModel ?? null,
      entry.odooId ?? null,
      entry.odooEventId ?? null,
      entry.detail === undefined ? null : JSON.stringify(entry.detail),
      entry.ip ?? null,
    )
    .run();
}
