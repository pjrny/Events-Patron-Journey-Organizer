// Organizer authentication: magic link (primary) + email/PIN (backup) -> HS256 JWT bound to a D1 session row.
import type { Env } from "./env";
import { HttpError, clientIp } from "./http";
import { hashPin, verifyPin, randomToken, sha256Hex, signJwt, verifyJwt, type JwtClaims } from "./crypto";
import { audit } from "./db";
import { sendOdooMail, type MailResult } from "./mail";

export const SESSION_COOKIE = "pj_session";
const PIN_MAX_FAILS = 5;
const PIN_LOCK_MINUTES = 15;
const MAGIC_MAX_REQUESTS = 5; // per email per 15 min

export interface Organizer {
  id: number;
  email: string;
  odoo_partner_id: number | null;
  display_name: string | null;
  pin_hash: string | null;
  role: string;
  tier: string;
  active: number;
}

export interface AuthContext {
  organizer: Organizer;
  claims: JwtClaims;
  via: "bearer" | "cookie";
}

export function normalizeEmail(v: unknown): string {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) throw new HttpError(400, "A valid email is required", "invalid_email");
  return e;
}

export function validatePin(v: unknown): string {
  const p = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  if (!/^\d{6,12}$/.test(p)) throw new HttpError(400, "PIN must be 6-12 digits", "invalid_pin");
  return p;
}

function requireSecrets(env: Env): { jwt: string; pepper: string } {
  if (!env.JWT_SECRET) throw new HttpError(503, "JWT_SECRET is not configured", "auth_not_configured");
  return { jwt: env.JWT_SECRET, pepper: env.PIN_PEPPER ?? "" };
}

export async function getOrganizerByEmail(env: Env, email: string): Promise<Organizer | null> {
  return env.DB.prepare("SELECT * FROM organizers WHERE email = ?").bind(email).first<Organizer>();
}

export async function getOrganizer(env: Env, id: number): Promise<Organizer | null> {
  return env.DB.prepare("SELECT * FROM organizers WHERE id = ?").bind(id).first<Organizer>();
}

async function recordAttempt(env: Env, email: string, method: string, ip: string | null, success: boolean) {
  await env.DB.prepare("INSERT INTO login_attempts (email, method, ip, success) VALUES (?, ?, ?, ?)")
    .bind(email, method, ip, success ? 1 : 0)
    .run();
}

/** Failed PIN attempts in the last 15 min that happened after the most recent successful PIN login. */
async function recentPinFailures(env: Env, email: string): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts
     WHERE email = ? AND method = 'pin' AND success = 0
       AND created_at > datetime('now', ?)
       AND created_at > COALESCE((SELECT MAX(created_at) FROM login_attempts WHERE email = ? AND method = 'pin' AND success = 1), '1970-01-01')`,
  )
    .bind(email, `-${PIN_LOCK_MINUTES} minutes`, email)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function setOrganizerPin(env: Env, organizerId: number, pin: string): Promise<void> {
  const { pepper } = requireSecrets(env);
  const h = await hashPin(validatePin(pin), pepper);
  await env.DB.prepare("UPDATE organizers SET pin_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(h, organizerId).run();
}

export async function upsertOrganizer(
  env: Env,
  o: { email: string; odoo_partner_id?: number | null; display_name?: string | null; role?: string },
): Promise<Organizer> {
  await env.DB.prepare(
    `INSERT INTO organizers (email, odoo_partner_id, display_name, role) VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       odoo_partner_id = COALESCE(excluded.odoo_partner_id, organizers.odoo_partner_id),
       display_name = COALESCE(excluded.display_name, organizers.display_name),
       active = 1,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(o.email, o.odoo_partner_id ?? null, o.display_name ?? null, o.role ?? "organizer")
    .run();
  return (await getOrganizerByEmail(env, o.email))!;
}

export async function createSession(env: Env, req: Request, org: Organizer, method: "magic_link" | "pin") {
  const { jwt } = requireSecrets(env);
  const ttlH = Number(env.SESSION_TTL_HOURS || 12);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.round(ttlH * 3600);
  const sid = randomToken(24);
  await env.DB.prepare(
    "INSERT INTO sessions (session_id, organizer_id, auth_method, user_agent, ip, expires_at) VALUES (?, ?, ?, ?, ?, datetime(?, 'unixepoch'))",
  )
    .bind(sid, org.id, method, (req.headers.get("user-agent") ?? "").slice(0, 200), clientIp(req), exp)
    .run();
  const token = await signJwt({ sub: String(org.id), sid, email: org.email, role: org.role, iat: now, exp }, jwt);
  await audit(env, { organizerId: org.id, action: "auth.login", detail: { method }, ip: clientIp(req) });
  return { token, expires_at: new Date(exp * 1000).toISOString(), max_age: exp - now };
}

export function sessionCookie(token: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(req: Request, name: string): string | null {
  const c = req.headers.get("cookie") ?? "";
  for (const part of c.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

/** Resolves the organizer from Authorization: Bearer <jwt> or the session cookie. Returns null if unauthenticated. */
export async function authenticate(req: Request, env: Env): Promise<AuthContext | null> {
  const { jwt } = requireSecrets(env);
  const auth = req.headers.get("authorization") ?? "";
  let token: string | null = null;
  let via: "bearer" | "cookie" = "bearer";
  if (auth.toLowerCase().startsWith("bearer ")) token = auth.slice(7).trim();
  else {
    token = readCookie(req, SESSION_COOKIE);
    via = "cookie";
  }
  if (!token) return null;
  const claims = await verifyJwt(token, jwt);
  if (!claims) return null;
  const row = await env.DB.prepare(
    `SELECT o.* FROM sessions s JOIN organizers o ON o.id = s.organizer_id
     WHERE s.session_id = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now') AND o.active = 1`,
  )
    .bind(claims.sid)
    .first<Organizer>();
  if (!row || String(row.id) !== claims.sub) return null;
  return { organizer: row, claims, via };
}

/** JWT gate for /api/organizer/*. Cookie-authenticated writes must be same-origin (CSRF guard). */
export async function requireOrganizer(req: Request, env: Env): Promise<AuthContext> {
  const ctx = await authenticate(req, env);
  if (!ctx) throw new HttpError(401, "Sign in required", "unauthorized");
  if (ctx.via === "cookie" && !["GET", "HEAD"].includes(req.method.toUpperCase())) {
    const origin = req.headers.get("origin");
    if (!origin || origin !== new URL(req.url).origin) throw new HttpError(403, "Cross-site request blocked", "csrf");
  }
  return ctx;
}

export async function revokeSession(env: Env, sid: string) {
  await env.DB.prepare("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE session_id = ? AND revoked_at IS NULL").bind(sid).run();
}

// ---------- Magic link ----------

export async function issueMagicToken(env: Env, organizerId: number): Promise<string> {
  const token = randomToken(32);
  const ttl = Number(env.MAGIC_LINK_TTL_MINUTES || 15);
  await env.DB.prepare("INSERT INTO magic_links (token_hash, organizer_id, expires_at) VALUES (?, ?, datetime('now', ?))")
    .bind(await sha256Hex(token), organizerId, `+${ttl} minutes`)
    .run();
  return token;
}

export function baseUrl(env: Env, req: Request): string {
  return (typeof env.PUBLIC_BASE_URL === "string" && env.PUBLIC_BASE_URL) || new URL(req.url).origin;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Always resolves the same way for unknown emails (no account enumeration).
 * Returns the mail result internally so the caller can audit it.
 */
export async function requestMagicLink(env: Env, req: Request, emailRaw: unknown): Promise<{ mail?: MailResult; known: boolean; throttled?: boolean }> {
  const email = normalizeEmail(emailRaw);
  const ip = clientIp(req);
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND method = 'magic_request' AND created_at > datetime('now', '-15 minutes')",
  )
    .bind(email)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAGIC_MAX_REQUESTS) return { known: false, throttled: true };
  const org = await getOrganizerByEmail(env, email);
  await recordAttempt(env, email, "magic_request", ip, !!org?.active);
  if (!org || !org.active) return { known: false };

  const token = await issueMagicToken(env, org.id);
  const link = `${baseUrl(env, req)}/auth/magic?token=${encodeURIComponent(token)}`;
  const ttl = Number(env.MAGIC_LINK_TTL_MINUTES || 15);
  const name = org.display_name ? esc(org.display_name) : "there";
  const mail = await sendOdooMail(env, {
    to: org.email,
    subject: "Your Patron Journey organizer sign-in link",
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1d1d1f">
<p>Hi ${name},</p>
<p>Use this link to sign in to the Patron Journey organizer dashboard. It works once and expires in ${ttl} minutes.</p>
<p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;background:#6b3fa0;color:#fff;border-radius:6px;text-decoration:none">Sign in to the dashboard</a></p>
<p style="font-size:13px;color:#666">If the button does not work, paste this into your browser:<br>${esc(link)}</p>
<p style="font-size:13px;color:#666">If you did not ask to sign in, ignore this email.</p></div>`,
  });
  await audit(env, { organizerId: org.id, action: "auth.magic_link_sent", odooModel: "mail.mail", odooId: mail.mail_id ?? undefined, detail: { mail_status: mail.status, mail_detail: mail.detail }, ip });
  return { known: true, mail };
}

export async function consumeMagicLink(env: Env, req: Request, tokenRaw: unknown) {
  const token = typeof tokenRaw === "string" ? tokenRaw.trim() : "";
  if (!token || token.length > 200) throw new HttpError(400, "Missing sign-in token", "invalid_token");
  const row = await env.DB.prepare(
    `UPDATE magic_links SET used_at = CURRENT_TIMESTAMP
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
     RETURNING organizer_id`,
  )
    .bind(await sha256Hex(token))
    .first<{ organizer_id: number }>();
  if (!row) throw new HttpError(401, "This sign-in link is invalid, expired, or already used", "invalid_token");
  const org = await getOrganizer(env, row.organizer_id);
  if (!org || !org.active) throw new HttpError(401, "Account is not active", "inactive");
  await recordAttempt(env, org.email, "magic_link", clientIp(req), true);
  return { organizer: org, ...(await createSession(env, req, org, "magic_link")) };
}

// ---------- PIN ----------

export async function pinLogin(env: Env, req: Request, emailRaw: unknown, pinRaw: unknown) {
  const { pepper } = requireSecrets(env);
  const email = normalizeEmail(emailRaw);
  const ip = clientIp(req);
  if ((await recentPinFailures(env, email)) >= PIN_MAX_FAILS) {
    throw new HttpError(429, `Too many failed PIN attempts. Try again in ${PIN_LOCK_MINUTES} minutes or use a magic link.`, "locked");
  }
  const pin = typeof pinRaw === "string" || typeof pinRaw === "number" ? String(pinRaw).trim() : "";
  const org = await getOrganizerByEmail(env, email);
  const ok = !!(org && org.active && org.pin_hash && pin && (await verifyPin(pin, org.pin_hash, pepper)));
  await recordAttempt(env, email, "pin", ip, ok);
  if (!ok) {
    if (org) await audit(env, { organizerId: org.id, action: "auth.pin_failed", ip });
    throw new HttpError(401, "Email or PIN is incorrect", "invalid_credentials");
  }
  return { organizer: org!, ...(await createSession(env, req, org!, "pin")) };
}
