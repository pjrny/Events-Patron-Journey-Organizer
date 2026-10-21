/** Competitor threat model (competitor-threat.v1) shared by GET /api/competitors and /api/weather/risk. No contact data. */
import type { Env } from "./env";
import { HttpError, clientIp } from "./http";
import { haversineKm, festivalsRateLimit } from "./festivals";

export const RADIUS_KM = 100, DATE_WINDOW_DAYS = 14, OPEN_WINDOW_WEEKS = 6;
const DAY = 86400000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const r2 = (x: number) => Math.round(x * 100) / 100;

export type Target = { lat: number; lon: number; city: string | null; country: string | null; start: Date | null; days: number; month: number | null; genre: string | null; lineup: string[] };
type Row = { id: number; name: string; city: string; state: string; country: string; lat: number | null; lon: number | null; month: number | null; start_date: string | null; end_date: string | null; category: string | null; subcategory: string | null; attendance: number | null; website: string | null; lineup?: string | null };

/** Project a listed edition (mostly 2018) onto the target's year, keeping month/day and duration. */
function project(r: Row, ref: Date): { s: Date; e: Date } | null {
  if (!r.start_date || !/^\d{4}-\d{2}-\d{2}/.test(r.start_date)) return null;
  const s0 = new Date(r.start_date.slice(0, 10) + "T00:00:00Z"), e0 = r.end_date ? new Date(r.end_date.slice(0, 10) + "T00:00:00Z") : s0;
  const len = Math.max(0, Math.min(30, Math.round((e0.getTime() - s0.getTime()) / DAY)));
  let best: { s: Date; e: Date } | null = null;
  for (const y of [ref.getUTCFullYear() - 1, ref.getUTCFullYear(), ref.getUTCFullYear() + 1]) {
    const s = new Date(Date.UTC(y, s0.getUTCMonth(), s0.getUTCDate()));
    const c = { s, e: addDays(s, len) };
    if (!best || Math.abs(c.s.getTime() - ref.getTime()) < Math.abs(best.s.getTime() - ref.getTime())) best = c;
  }
  return best;
}
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9& ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["all", "the", "and", "music", "festival"].includes(w));

export function threat(r: Row, t: Target, distKm: number | null) {
  // Proximity: 1.0 at the same spot -> 0.2 at 100 km.
  const prox = distKm == null ? 0.9 : Math.max(0.2, 1 - (0.8 * distKm) / RADIUS_KM);
  const proxWhy = distKm == null ? "Same city (no coordinates)" : `${Math.round(distKm)} km away`;
  // Date overlap
  let date = 0.5, dateWhy = "Same month (no exact date given)", gap: number | null = null, proj: { s: Date; e: Date } | null = null;
  if (t.start) {
    proj = project(r, t.start);
    if (proj) {
      const te = addDays(t.start, t.days - 1);
      gap = proj.e < t.start ? Math.round((t.start.getTime() - proj.e.getTime()) / DAY) : proj.s > te ? Math.round((proj.s.getTime() - te.getTime()) / DAY) : 0;
      date = gap === 0 ? 1 : gap <= 3 ? 0.8 : gap <= 7 ? 0.6 : gap <= 14 ? 0.35 : 0.1;
      dateWhy = gap === 0 ? "Same dates" : `${gap} day${gap === 1 ? "" : "s"} apart (projected from ${r.start_date!.slice(0, 4)} edition)`;
    } else if (r.month) { date = r.month === t.start.getUTCMonth() + 1 ? 0.5 : 0.1; dateWhy = "Month only"; }
  } else if (t.month && r.month && r.month !== t.month) { date = 0.1; dateWhy = "Different month"; }
  // Genre similarity
  let genre = 0.5, genreWhy = "No genre given";
  if (t.genre) {
    const g = t.genre.toLowerCase(), cat = (r.category ?? "").toLowerCase(), sub = (r.subcategory ?? "").toLowerCase();
    const gw = words(g), sw = new Set(words(sub));
    if (sub && !sub.startsWith("~") && (sub.includes(g) || gw.some((w) => sw.has(w)))) { genre = 1; genreWhy = `Same genre (${r.subcategory})`; }
    else if (cat && (cat === g || g.includes(cat) || cat.includes(g))) { genre = 0.7; genreWhy = `Same type (${r.category})`; }
    else if (cat === "music" && /music|edm|electronic|rock|hip|rap|country|jazz|blues|folk|indie|pop|metal|reggae|latin|r&b/.test(g)) { genre = 0.6; genreWhy = `Music, different/unknown genre (${r.subcategory ?? "?"})`; }
    else { genre = 0.25; genreWhy = `Different type (${r.category ?? "?"})`; }
  }
  // Size
  const att = r.attendance;
  const size = att == null ? 0.5 : Math.min(1, Math.max(0.3, Math.log10(Math.max(att, 10)) / 5));
  const sizeWhy = att == null ? "Attendance unknown" : `~${att.toLocaleString("en-US")} attendees`;
  // Lineup overlap
  let lineup = 1, lineupWhy = "Lineup not checked (directory has no lineups yet)";
  if (t.lineup.length && r.lineup) {
    const theirs = new Set(r.lineup.toLowerCase().split(/[\n,;|]+/).map((s) => s.trim()).filter(Boolean));
    const shared = t.lineup.filter((a) => theirs.has(a.toLowerCase()));
    lineup = 1 + Math.min(1, shared.length * 0.25); lineupWhy = shared.length ? `${shared.length} shared artist(s): ${shared.slice(0, 5).join(", ")}` : "No shared artists";
  } else if (t.lineup.length) lineupWhy = "Lineup given, but this listing has no lineup data";
  const score = Math.round(Math.min(100, 100 * prox * date * genre * size * lineup));
  return { score, gap_days: gap, projected_start: proj ? ymd(proj.s) : null, projected_end: proj ? ymd(proj.e) : null,
    factors: { proximity: { value: r2(prox), why: proxWhy }, date_overlap: { value: r2(date), why: dateWhy }, genre: { value: r2(genre), why: genreWhy }, size: { value: r2(size), why: sizeWhy }, lineup: { value: r2(lineup), why: lineupWhy } } };
}

async function nearby(env: Env, t: Target): Promise<{ r: Row; d: number | null }[]> {
  const dLat = RADIUS_KM / 111, dLon = RADIUS_KM / (111 * Math.max(0.05, Math.cos((t.lat * Math.PI) / 180)));
  const rows = (await env.DB.prepare(
    "SELECT id,name,city,state,country,lat,lon,month,start_date,end_date,category,subcategory,attendance,website FROM festival_directory WHERE (lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?) OR (city = ? COLLATE NOCASE AND country = ? AND lat IS NULL) LIMIT 5000",
  ).bind(t.lat - dLat, t.lat + dLat, t.lon - dLon, t.lon + dLon, t.city ?? "", t.country ?? "").all<Row>()).results ?? [];
  return rows.map((r) => ({ r, d: r.lat != null && r.lon != null ? haversineKm(t.lat, t.lon, r.lat, r.lon) : null })).filter((x) => x.d == null || x.d <= RADIUS_KM);
}

function inWindow(r: Row, t: Target): boolean {
  if (t.start) {
    const p = project(r, t.start); if (!p) return !!r.month && r.month === t.start.getUTCMonth() + 1;
    const te = addDays(t.start, t.days - 1);
    return p.e.getTime() >= addDays(t.start, -DATE_WINDOW_DAYS).getTime() && p.s.getTime() <= addDays(te, DATE_WINDOW_DAYS).getTime();
  }
  return !t.month || r.month === t.month;
}
const card = (r: Row, d: number | null, th: ReturnType<typeof threat>) => ({
  id: r.id, name: r.name, city: r.city, state: r.state, country: r.country, type: r.category, genre: r.subcategory, attendance: r.attendance,
  website: r.website ? `https://${r.website}` : null, listed_start: r.start_date, listed_end: r.end_date, month: r.month,
  projected_start: th.projected_start, projected_end: th.projected_end, distance_km: d == null ? null : Math.round(d * 10) / 10,
  threat: th.score, factors: th.factors,
});

/** Core analysis; used by both endpoints. */
export async function analyzeCompetition(env: Env, t: Target, opts: { openWeekends?: boolean; limit?: number } = {}) {
  const all = await nearby(env, t);
  const comp = all.filter((x) => inWindow(x.r, t)).map((x) => card(x.r, x.d, threat(x.r, t, x.d))).sort((a, b) => b.threat - a.threat || (a.distance_km ?? 0) - (b.distance_km ?? 0));
  const total = comp.reduce((a, c) => a + c.threat, 0);
  const out: any = {
    schema: "competitor-threat.v1", radius_km: RADIUS_KM, date_window_days: t.start ? DATE_WINDOW_DAYS : null, basis: t.start ? `within ${RADIUS_KM} km and ±${DATE_WINDOW_DAYS} days` : `within ${RADIUS_KM} km, same month`,
    count: comp.length, total_threat: total, competition_score: Math.round(100 * (1 - Math.exp(-total / 300))), events: comp.slice(0, opts.limit ?? 50),
  };
  if (opts.openWeekends && t.start) {
    const sat0 = addDays(t.start, (6 - t.start.getUTCDay() + 7) % 7);
    const weekends: any[] = [];
    for (let w = -OPEN_WINDOW_WEEKS; w <= OPEN_WINDOW_WEEKS; w++) {
      const s = addDays(sat0, 7 * w), tt: Target = { ...t, start: s, days: 2 };
      let sum = 0, n = 0, top: any = null;
      for (const x of all) { const th = threat(x.r, tt, x.d); if ((th.gap_days ?? 99) <= 7) { sum += th.score; n++; if (!top || th.score > top.threat) top = { name: x.r.name, threat: th.score }; } }
      weekends.push({ start: ymd(s), end: ymd(addDays(s, 1)), label: `${MON[s.getUTCMonth()]} ${s.getUTCDate()}-${addDays(s, 1).getUTCDate()}`, total_threat: sum, events_within_7_days: n, biggest: top, weeks_from_target: w });
    }
    out.open_weekends = [...weekends].sort((a, b) => a.total_threat - b.total_threat || Math.abs(a.weeks_from_target) - Math.abs(b.weeks_from_target)).slice(0, 5);
    out.weekends = weekends;
  }
  return out;
}

export async function competitorsApi(env: Env, req: Request, url: URL, geocodeFn: (env: Env, q: string) => Promise<{ lat: number; lon: number; city: string | null; country_code: string | null }>) {
  await festivalsRateLimit(env, req);
  const p = url.searchParams, s = (k: string, m = 120) => { const v = (p.get(k) ?? "").trim(); return v ? v.slice(0, m) : null; };
  let lat = p.get("lat") ? Number(p.get("lat")) : null, lon = p.get("lon") ? Number(p.get("lon")) : null;
  let city = s("city"), country = s("country", 2)?.toUpperCase() ?? null;
  if ((lat == null) !== (lon == null) || (lat != null && (!isFinite(lat) || !isFinite(lon!)))) throw new HttpError(400, "lat and lon must both be numbers", "invalid_param");
  let located = "coordinates";
  if (lat == null) {
    if (!city) throw new HttpError(400, "Give city (e.g. 'Austin, TX') or lat & lon.", "missing_location");
    const parts = city.split(",").map((x) => x.trim());
    const row = await env.DB.prepare("SELECT AVG(lat) lat, AVG(lon) lon, MAX(country) country FROM festival_directory WHERE city = ? COLLATE NOCASE AND lat IS NOT NULL" + (parts[1] && parts[1].length === 2 ? " AND (state = ? COLLATE NOCASE OR country = ?)" : "") + (country ? " AND country = ?" : ""))
      .bind(...[parts[0], ...(parts[1] && parts[1].length === 2 ? [parts[1], parts[1].toUpperCase()] : []), ...(country ? [country] : [])]).first<any>();
    if (row?.lat != null) { lat = row.lat; lon = row.lon; country = country ?? row.country; located = "directory city centroid"; }
    else { const g = await geocodeFn(env, city); lat = g.lat; lon = g.lon; country = country ?? g.country_code; located = "OpenStreetMap Nominatim"; }
    city = parts[0];
  }
  const date = s("date", 10); let start: Date | null = null;
  if (date) { if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) throw new HttpError(400, "date must be YYYY-MM-DD", "invalid_date"); start = new Date(date + "T00:00:00Z"); }
  const month = start ? start.getUTCMonth() + 1 : p.get("month") ? Number(p.get("month")) : null;
  if (month != null && !(month >= 1 && month <= 12)) throw new HttpError(400, "month must be 1-12", "invalid_param");
  const days = Math.min(5, Math.max(1, Number(p.get("days") ?? 2) || 2));
  const lineup = (p.get("lineup") ?? "").slice(0, 4000).split(/[\n,;|]+/).map((x) => x.trim()).filter(Boolean).slice(0, 100);
  const t: Target = { lat: lat!, lon: lon!, city, country, start, days, month, genre: s("genre", 60), lineup };
  const res = await analyzeCompetition(env, t, { openWeekends: true, limit: Math.min(100, Math.max(1, Number(p.get("limit") ?? 50) || 50)) });
  return { ...res, input: { city, country, lat: t.lat, lon: t.lon, located_by: located, date, days, month, genre: t.genre, lineup_count: lineup.length },
    notes: ["Listed dates are mostly 2018 editions, projected onto your year by month/day; recurring festivals usually keep their slot.", "Coordinates are city centroids, not venues.", "Lineups are not in the directory yet, so lineup overlap is neutral (x1.0)."] };
}
