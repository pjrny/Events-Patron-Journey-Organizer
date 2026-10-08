export interface Env {
  // Bindings
  DB: D1Database;
  CACHE?: KVNamespace; // optional: cache only

  // Plain vars (wrangler.jsonc)
  APP_ENV: string;
  ODOO_URL: string;
  ODOO_DB?: string;
  ODOO_TEMPLATE_EVENT_ID: string;
  PAID_UPGRADE_URL: string;
  PUBLIC_EVENTS_URL: string;
  SESSION_TTL_HOURS: string;
  MAGIC_LINK_TTL_MINUTES: string;
  /** Optional: exact name of the secret binding holding the Odoo API key, if it is not one of the defaults. */
  ODOO_KEY_BINDING?: string;

  // Secrets (Cloudflare dashboard / `wrangler secret put`). Never logged, never returned.
  ADMIN_TOKEN?: string;
  JWT_SECRET?: string;
  PIN_PEPPER?: string;
  ORGANIZER_TEST_PASSWORD?: string;
  ATTENDEE_TEST_PASSWORD?: string;
  [key: string]: unknown;
}

/** Names of non-secret vars declared in wrangler.jsonc (used to tell secrets apart from vars by NAME only). */
export const PLAIN_VARS = new Set([
  "APP_ENV",
  "ODOO_URL",
  "ODOO_DB",
  "ODOO_TEMPLATE_EVENT_ID",
  "PAID_UPGRADE_URL",
  "PUBLIC_EVENTS_URL",
  "SESSION_TTL_HOURS",
  "MAGIC_LINK_TTL_MINUTES",
  "ODOO_KEY_BINDING",
]);

/** Lists the NAMES (never values) of string bindings that are not declared plain vars, i.e. secrets. */
export function secretNames(env: Env): string[] {
  return Object.keys(env)
    .filter((k) => typeof env[k] === "string" && !PLAIN_VARS.has(k))
    .sort();
}
