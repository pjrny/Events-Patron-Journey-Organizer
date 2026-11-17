/**
 * Organizer historic show data (talent-history.v1) — docs/HISTORY.md.
 * Storage: D1 table talent_history, private per signed-in organizer (GET/POST/DELETE /api/talent/history).
 * Signed-out visitors keep rows in their browser (localStorage) and send them with each draw request.
 * Rows feed the talent "past draw" signal (actual_sales quality) and the artist pay estimate.
 */
import type { Env } from "./env";
import { HttpError } from "./http";
import { requireOrganizer } from "./auth";

export type HistRow = { id?: number; artist: string; city: string | null; date: string | null; venue: string | null; capacity: number | null; tickets_sold: number | null; gross: number | null; fee_paid: number | null; notes: string | null };
export const MAX_ROWS_PER_ORGANIZER = 2000, MAX_ROWS_PER_REQUEST = 500;
export const normName = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const num = (v: any, max: number): number | null => {
  if (v == null || v === "") return null;
  const x = Number(String(v).replace(/[$,\s]/g, ""));
  return isFinite(x) && x >= 0 ? Math.min(max, x) : null;
};
const str = (v: any, n: number) => (v == null ? null : String(v).trim().slice(0, n) || null);
function normDate(v: any): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); // US m/d/y
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  const t = Date.parse(s); return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
/** Validates/cleans client rows. Rows without an artist, or with neither tickets_sold nor fee_paid, are dropped. */
export function cleanRows(rows: any): HistRow[] {
  if (!Array.isArray(rows)) return [];
  const out: HistRow[] = [];
  for (const r of rows.slice(0, MAX_ROWS_PER_REQUEST)) {
    if (!r || typeof r !== "object") continue;
    const artist = str(r.artist, 120); if (!artist) continue;
    const row: HistRow = { artist, city: str(r.city, 120), date: normDate(r.date ?? r.show_date), venue: str(r.venue, 160), capacity: num(r.capacity, 2_000_000), tickets_sold: num(r.tickets_sold, 2_000_000), gross: num(r.gross, 1e9), fee_paid: num(r.fee_paid, 1e8), notes: str(r.notes, 300) };
    if (row.tickets_sold == null && row.fee_paid == null) continue;
    if (row.capacity != null) row.capacity = Math.round(row.capacity);
    if (row.tickets_sold != null) row.tickets_sold = Math.round(row.tickets_sold);
    out.push(row);
  }
  return out;
}

export async function historyApi(env: Env, req: Request, url: URL) {
  const { organizer } = await requireOrganizer(req, env);
  const m = req.method.toUpperCase();
  if (m === "GET") {
    const rs = await env.DB.prepare("SELECT id, artist, city, show_date AS date, venue, capacity, tickets_sold, gross, fee_paid, notes FROM talent_history WHERE organizer_id = ? ORDER BY show_date DESC, id DESC LIMIT ?").bind(organizer.id, MAX_ROWS_PER_ORGANIZER).all();
    return { schema: "talent-history.v1", ok: true, storage: "account", organizer: organizer.email, rows: rs.results ?? [] };
  }
  if (m === "POST") {
    const b: any = await req.json().catch(() => { throw new HttpError(400, "Body must be JSON", "invalid_input"); });
    const rows = cleanRows(b.rows);
    if (!rows.length) throw new HttpError(400, "No usable rows. Each row needs an artist plus tickets sold or fee paid.", "no_rows");
    const have = await env.DB.prepare("SELECT COUNT(*) AS n FROM talent_history WHERE organizer_id = ?").bind(organizer.id).first<{ n: number }>();
    if ((have?.n ?? 0) + rows.length > MAX_ROWS_PER_ORGANIZER) throw new HttpError(400, `Limit is ${MAX_ROWS_PER_ORGANIZER} rows per organizer.`, "too_many_rows");
    if (b.replace === true) await env.DB.prepare("DELETE FROM talent_history WHERE organizer_id = ?").bind(organizer.id).run();
    await env.DB.batch(rows.map((r) => env.DB.prepare("INSERT INTO talent_history (organizer_id, artist, artist_norm, city, show_date, venue, capacity, tickets_sold, gross, fee_paid, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(organizer.id, r.artist, normName(r.artist), r.city, r.date, r.venue, r.capacity, r.tickets_sold, r.gross, r.fee_paid, r.notes)));
    return { ok: true, added: rows.length, dropped: (Array.isArray(b.rows) ? b.rows.length : 0) - rows.length };
  }
  if (m === "DELETE") {
    const id = url.searchParams.get("id");
    if (id === "all") await env.DB.prepare("DELETE FROM talent_history WHERE organizer_id = ?").bind(organizer.id).run();
    else if (id && /^\d+$/.test(id)) await env.DB.prepare("DELETE FROM talent_history WHERE organizer_id = ? AND id = ?").bind(organizer.id, Number(id)).run();
    else throw new HttpError(400, "id=<row id> or id=all", "invalid_input");
    return { ok: true };
  }
  throw new HttpError(405, "GET, POST or DELETE", "method_not_allowed");
}
