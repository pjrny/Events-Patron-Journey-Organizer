// Outbound email through Odoo's native mail queue (mail.mail), so organizers get mail
// from the same Odoo Online mail servers that send ticket + reminder emails.
import type { Env } from "./env";
import { odoo, OdooError } from "./odoo";

export interface MailResult {
  mail_id: number | null;
  /** sent = Odoo delivered and auto-deleted it, or state is "sent"; queued = waiting for Odoo's mail cron; exception = failed. */
  status: "sent" | "queued" | "exception" | "error";
  detail?: string;
}

export async function sendOdooMail(env: Env, msg: { to: string; subject: string; html: string }): Promise<MailResult> {
  const o = odoo(env);
  const vals: Record<string, unknown> = {
    subject: msg.subject,
    body_html: msg.html,
    email_to: msg.to,
    auto_delete: true, // the body contains a one-time login link: do not keep it in Odoo once sent
  };
  if (env.MAIL_FROM) vals.email_from = env.MAIL_FROM;
  let mailId: number | null = null;
  try {
    const created = await o.call<number[] | number>("mail.mail", "create", { vals_list: [vals] });
    mailId = Array.isArray(created) ? created[0] : created;
  } catch (e) {
    return { mail_id: null, status: "error", detail: e instanceof OdooError ? `create: ${e.message}` : String(e) };
  }
  try {
    await o.call("mail.mail", "send", { ids: [mailId] });
  } catch (e) {
    // Not fatal: the record is queued and Odoo's mail cron will pick it up.
    return { mail_id: mailId, status: "queued", detail: e instanceof OdooError ? `send: ${e.message}` : String(e) };
  }
  try {
    const rows = await o.call<any[]>("mail.mail", "search_read", {
      domain: [["id", "=", mailId]],
      fields: ["state", "failure_reason"],
    });
    if (!rows.length) return { mail_id: mailId, status: "sent", detail: "delivered and auto-deleted by Odoo" };
    const r = rows[0];
    if (r.state === "sent") return { mail_id: mailId, status: "sent" };
    if (r.state === "exception") return { mail_id: mailId, status: "exception", detail: String(r.failure_reason || "").slice(0, 300) };
    return { mail_id: mailId, status: "queued", detail: `state=${r.state}` };
  } catch {
    return { mail_id: mailId, status: "queued" };
  }
}
