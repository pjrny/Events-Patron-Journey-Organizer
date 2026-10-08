// Organizer self-service onboarding.
// Someone who signed up / signed in on pjrny.com (an Odoo website portal user) can become an organizer
// without an admin step: their first VERIFIED magic-link sign-in creates the D1 organizers row.
// Emails without an Odoo res.users account are never auto-created.
import type { Env } from "./env";
import { odoo, OdooError } from "./odoo";

export const SIGNUP_REQUIRED_MESSAGE =
  "We couldn't find a pjrny.com account for that email. First create your account at https://www.pjrny.com/web/signup " +
  "(or sign in at https://www.pjrny.com/web/login), then come back here and request an email sign-in link with the same address.";

export const PIN_NOT_SET_MESSAGE =
  "No organizer PIN is set for this email yet. Use \"Email me a sign-in link\" to sign in the first time, then set a PIN in the dashboard.";

export interface OdooAccount {
  user_id: number;
  partner_id: number | null;
  name: string | null;
  login: string;
  portal: boolean; // res.users.share = true (portal / website user)
  website_id: number | null; // res.users.website_id (website-specific accounts), null = all websites
  company_id: number | null; // res.users.company_id (3 = pjrny for users who signed up on www.pjrny.com)
  pjrny: boolean; // tied to the pjrny.com website (website_id) or its company
  match: "login" | "email";
}

const m2oId = (v: unknown): number | null => (Array.isArray(v) && typeof v[0] === "number" ? v[0] : typeof v === "number" ? v : null);
const m2oName = (v: unknown): string | null => (Array.isArray(v) && typeof v[1] === "string" ? v[1] : null);
const lc = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/**
 * Finds an active Odoo res.users account for `email` (exact, case-insensitive match on login, else on email).
 * Preference: users tied to the pjrny.com website, then portal users, then internal users; login match beats email match.
 * Returns null when there is no such user (contacts without a user account do not count: they never signed up).
 */
export async function findOdooAccount(env: Env, email: string): Promise<OdooAccount | null> {
  const o = odoo(env);
  const want = lc(email);
  const domain = ["|", ["login", "=ilike", want], ["email", "=ilike", want]];
  const base = ["id", "login", "email", "name", "partner_id", "share", "active", "company_id"];
  let rows: any[];
  try {
    rows = await o.call<any[]>("res.users", "search_read", { domain, fields: [...base, "website_id"], limit: 20, context: { active_test: true } });
  } catch (e) {
    // website_id only exists when the website module is installed; retry without it.
    if (!(e instanceof OdooError) || !/website_id/i.test(e.message)) throw e;
    rows = await o.call<any[]>("res.users", "search_read", { domain, fields: base, limit: 20, context: { active_test: true } });
  }
  const signupSite = Number(env.ORGANIZER_SIGNUP_WEBSITE_ID || 2);
  const signupCompany = await websiteCompany(env, signupSite);
  // =ilike treats _ and % as wildcards, so re-check for an exact match here.
  const candidates: OdooAccount[] = rows
    .filter((r) => r.active !== false && (lc(r.login) === want || lc(r.email) === want))
    .map((r) => ({
      user_id: r.id,
      partner_id: m2oId(r.partner_id),
      name: (typeof r.name === "string" && r.name) || m2oName(r.partner_id),
      login: String(r.login),
      portal: r.share === true,
      website_id: m2oId(r.website_id),
      company_id: m2oId(r.company_id),
      pjrny: m2oId(r.website_id) === signupSite || (signupCompany !== null && m2oId(r.company_id) === signupCompany),
      match: (lc(r.login) === want ? "login" : "email") as "login" | "email",
    }));
  if (!candidates.length) return null;
  const rank = (a: OdooAccount) => (a.website_id === signupSite ? 0 : 20) + (a.pjrny ? 0 : 10) + (a.portal ? 0 : 5) + (a.match === "login" ? 0 : 2);
  candidates.sort((a, b) => rank(a) - rank(b) || a.user_id - b.user_id);
  return candidates[0];
}

let companyCache: { site: number; company: number | null } | null = null;
/** company_id of the signup website (pjrny.com = website 2 -> company 3). Cached per isolate. */
async function websiteCompany(env: Env, siteId: number): Promise<number | null> {
  if (companyCache?.site === siteId) return companyCache.company;
  try {
    const rows = await odoo(env).call<any[]>("website", "search_read", { domain: [["id", "=", siteId]], fields: ["company_id"], limit: 1 });
    companyCache = { site: siteId, company: m2oId(rows[0]?.company_id) };
  } catch {
    return null;
  }
  return companyCache.company;
}
