// Minimal Odoo 19 External JSON-2 API client.
//   POST {ODOO_URL}/json/2/{model}/{method}
//   Authorization: bearer <api key>
//   Body: named args + optional ids + context
// Docs: https://www.odoo.com/documentation/19.0/developer/reference/external_api.html
// NOTE: on Odoo Online the external API requires the Custom plan.
import type { Env } from "./env";

/** Candidate secret binding names for the Odoo API key (first match wins). */
const KEY_CANDIDATES = [
  "ODOO_API_KEY",
  "ODOO_API_SECRET",
  "ODOO_APIKEY",
  "ODOO_KEY",
  "ODOO_SECRET",
  "ODOO_API_TOKEN",
  "ODOO_TOKEN",
  "ODOO_ADMIN_API_KEY",
];

export interface ResolvedKey {
  name: string; // binding NAME only, safe to report
  value: string; // never log/return
}

export function resolveOdooKey(env: Env): ResolvedKey | null {
  const pick = (name: string): ResolvedKey | null => {
    const v = env[name];
    return typeof v === "string" && v.length > 0 ? { name, value: v } : null;
  };
  if (env.ODOO_KEY_BINDING) {
    const r = pick(env.ODOO_KEY_BINDING);
    if (r) return r;
  }
  for (const n of KEY_CANDIDATES) {
    const r = pick(n);
    if (r) return r;
  }
  // Fallback: any string binding whose NAME looks like an Odoo key/secret/token.
  const guess = Object.keys(env)
    .filter((k) => /ODOO/i.test(k) && /(KEY|SECRET|TOKEN)/i.test(k))
    .sort();
  for (const n of guess) {
    const r = pick(n);
    if (r) return r;
  }
  return null;
}

export class OdooError extends Error {
  constructor(message: string, public status: number, public odooName?: string) {
    super(message);
  }
}

export interface OdooClient {
  call<T = unknown>(model: string, method: string, body?: Record<string, unknown>): Promise<T>;
  keyName: string;
}

export function odoo(env: Env): OdooClient {
  const key = resolveOdooKey(env);
  if (!key) throw new OdooError("No Odoo API key secret is bound to this Worker", 500, "missing_key");
  const base = env.ODOO_URL.replace(/\/+$/, "");
  return {
    keyName: key.name,
    async call<T>(model: string, method: string, body: Record<string, unknown> = {}): Promise<T> {
      const headers: Record<string, string> = {
        "content-type": "application/json; charset=utf-8",
        authorization: `bearer ${key.value}`,
        "user-agent": "events-patronjourney-worker/0.1",
      };
      if (env.ODOO_DB) headers["x-odoo-database"] = env.ODOO_DB;
      const res = await fetch(`${base}/json/2/${encodeURIComponent(model)}/${encodeURIComponent(method)}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data: any;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        // Only surface Odoo's short message + exception name. Never the debug traceback.
        const msg = (data && typeof data.message === "string" ? data.message : text.slice(0, 300)) || `HTTP ${res.status}`;
        throw new OdooError(msg, res.status, data?.name);
      }
      return data as T;
    },
  };
}

/** Public (unauthenticated) server version check. */
export async function odooVersion(env: Env): Promise<unknown> {
  const res = await fetch(`${env.ODOO_URL.replace(/\/+$/, "")}/web/webclient/version_info`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: {} }),
  });
  const data: any = await res.json().catch(() => null);
  return data?.result ?? { error: `HTTP ${res.status}` };
}
