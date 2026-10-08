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
  PUBLIC_BASE_URL?: string; // base for magic links (workers.dev until DNS moves)
  MAIL_FROM?: string; // optional From for magic-link mail; empty = Odoo default for the API user
  ALLOWED_WEBSITE_IDS?: string; // "1,2"
  PJ_SPONSOR_PARTNER_ID?: string;
  PJ_SPONSOR_TYPE_ID?: string;
  ODOO_TICKET_PRODUCT_ID?: string;

  // Secrets (Cloudflare dashboard / `wrangler secret put`). Never logged, never returned.
  ADMIN_TOKEN?: string;
  JWT_SECRET?: string;
  PIN_PEPPER?: string;
  ORGANIZER_TEST_PASSWORD?: string;
  ATTENDEE_TEST_PASSWORD?: string;
  TEST_ORGANIZER_PIN?: string; // smoke-test PIN for organizer+test@pjrny.com (secret, never committed)
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
  "PUBLIC_BASE_URL",
  "MAIL_FROM",
  "ALLOWED_WEBSITE_IDS",
  "PJ_SPONSOR_PARTNER_ID",
  "PJ_SPONSOR_TYPE_ID",
  "ODOO_TICKET_PRODUCT_ID",
  "PUBLIC_SITE_BY_WEBSITE",
]);

/** Lists the NAMES (never values) of string bindings that are not declared plain vars, i.e. secrets. */
export function secretNames(env: Env): string[] {
  return Object.keys(env)
    .filter((k) => typeof env[k] === "string" && !PLAIN_VARS.has(k))
    .sort();
}
