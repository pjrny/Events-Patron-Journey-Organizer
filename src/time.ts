// Timezone helpers. Odoo stores datetimes as naive UTC "YYYY-MM-DD HH:MM:SS".
import { HttpError } from "./http";

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - utcMs;
}

export function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function toOdooUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Accepts either a wall-clock local time ("2026-11-14T18:00") interpreted in `tz`,
 * or an absolute ISO timestamp with Z / offset. Returns an Odoo UTC string.
 */
export function parseEventDate(input: unknown, tz: string, field: string): string {
  if (typeof input !== "string" || !input.trim()) throw new HttpError(400, `${field} is required`, "invalid_input");
  const s = input.trim();
  const m = LOCAL_RE.exec(s);
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(se ?? 0));
    let utc = wall - tzOffsetMs(wall, tz);
    utc = wall - tzOffsetMs(utc, tz); // second pass handles DST edges
    return toOdooUtc(new Date(utc));
  }
  const t = Date.parse(s);
  if (Number.isNaN(t) || !/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    throw new HttpError(400, `${field} must be local "YYYY-MM-DDTHH:MM" or ISO with offset`, "invalid_input");
  }
  return toOdooUtc(new Date(t));
}

/** Odoo UTC string -> local wall-clock "YYYY-MM-DDTHH:MM" in tz (for dashboard display/edit). */
export function odooUtcToLocal(odooUtc: string | false | null | undefined, tz: string): string | null {
  if (!odooUtc) return null;
  const utc = Date.parse(odooUtc.replace(" ", "T") + "Z");
  if (Number.isNaN(utc)) return null;
  return new Date(utc + tzOffsetMs(utc, tz)).toISOString().slice(0, 16);
}
