/** Festival directory (D1 festival_directory): competition lookup + public GET /api/festivals. No contact emails/phones stored. */
import type { Env } from "./env";
import { HttpError, clientIp } from "./http";
import { sha256Hex } from "./crypto";

const COLS = "id, name, city, state, country, lat, lon, geo_precision, month, start_date, end_date, category, subcategory, attendance, website";
const R = 6371;
export function haversineKm(a: number, b: number, c: number, d: number) {
  const t = Math.PI / 180, x = Math.sin(((c - a) * t) / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(((d - b) * t) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function shape(r: any, dist?: number | null) {
  return {
    id: r.id, name: r.name, city: r.city, state: r.state, country: r.country, month: r.month,
    start_date: r.start_date, end_date: r.end_date, type: r.category, genre: r.subcategory, attendance: r.attendance,
    website: r.website ? `https://${r.website}` : null, lat: r.lat, lon: r.lon, geo_precision: r.geo_precision,
    distance_km: dist == null ? null : Math.round(dist * 10) / 10,
  };
}

export type FestQuery = { city?: string; country?: string; state?: string; month?: number; lat?: number; lon?: number; radius_km?: number; q?: string; type?: string; limit?: number; offset?: number };

/** Union of (same city+country text match) and (within radius of lat/lon). Sorted by distance then name. */
export async function searchFestivals(env: Env, f: FestQuery) {
  const where: string[] = [], bind: any[] = [];
  if (f.month) { where.push("month = ?"); bind.push(f.month); }
  if (f.q) { where.push("name LIKE ?"); bind.push(`%${f.q}%`); }
  if (f.type) { where.push("category = ? COLLATE NOCASE"); bind.push(f.type); }
  const geo: string[] = [];
  const hasPt = f.lat != null && f.lon != null && isFinite(f.lat) && isFinite(f.lon);
  const rad = Math.min(Math.max(f.radius_km ?? 100, 1), 500);
  if (f.city) {
    const p = ["city = ? COLLATE NOCASE"]; bind.push(f.city);
    if (f.country) { p.push("country = ?"); bind.push(f.country.toUpperCase()); }
    if (f.state) { p.push("(state = ? COLLATE NOCASE OR state IS NULL)"); bind.push(f.state); }
    geo.push("(" + p.join(" AND ") + ")");
  } else if (f.country) { where.push("country = ?"); bind.push(f.country.toUpperCase()); }
  if (hasPt) {
    const dLat = rad / 111, dLon = rad / (111 * Math.max(0.05, Math.cos((f.lat! * Math.PI) / 180)));
    geo.push("(lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?)"); bind.push(f.lat! - dLat, f.lat! + dLat, f.lon! - dLon, f.lon! + dLon);
  }
  if (geo.length) where.push("(" + geo.join(" OR ") + ")");
  if (!where.length) throw new HttpError(400, "Give at least one filter: city, country, month, lat/lon or q.", "missing_filter");
  const sql = `SELECT ${COLS} FROM festival_directory WHERE ${where.join(" AND ")} LIMIT 2000`;
  const rows = (await env.DB.prepare(sql).bind(...bind).all<any>()).results ?? [];
  let list = rows.map((r) => ({ r, d: hasPt && r.lat != null ? haversineKm(f.lat!, f.lon!, r.lat, r.lon) : null }));
  if (hasPt) {
    const cityL = f.city?.toLowerCase();
    list = list.filter((x) => (x.d != null && x.d <= rad) || (cityL && String(x.r.city).toLowerCase() === cityL));
  }
  list.sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9) || String(a.r.name).localeCompare(String(b.r.name)));
  const limit = Math.min(Math.max(f.limit ?? 25, 1), 100), offset = Math.max(f.offset ?? 0, 0);
  return { total: list.length, truncated: rows.length >= 2000, limit, offset, results: list.slice(offset, offset + limit).map((x) => shape(x.r, x.d)) };
}

/** Competition for /weather: same month, same city OR within 100 km. */
export async function festivalCompetition(env: Env, g: { lat: number; lon: number; city: string | null; state: string | null; country_code: string | null }, month: number) {
  const r = await searchFestivals(env, { city: g.city ?? undefined, country: g.country_code ?? undefined, month, lat: g.lat, lon: g.lon, radius_km: 100, limit: 25 });
  return {
    count: r.total,
    events: r.results.map((e) => ({ name: e.name, city: e.city, state: e.state, month: e.month, start_date: e.start_date, end_date: e.end_date, type: e.type, genre: e.genre, attendance: e.attendance, distance_km: e.distance_km })),
    basis: "same month; same city or within 100 km (city-centroid coordinates)",
    radius_km: 100,
    source: "Patron Journey festival directory (listed editions mostly 2018; month used as recurring signal)",
  };
}

const PER_WINDOW = 60, WINDOW_MS = 60_000;
export async function festivalsRateLimit(env: Env, req: Request) {
  const ip = await sha256Hex("fest-ip:" + (clientIp(req) ?? "unknown"));
  const now = Date.now(), w = Math.floor(now / WINDOW_MS), k = `fest|${ip}|${w}`;
  const row = await env.DB.prepare("INSERT INTO api_rate (k, n, exp_ms) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n").bind(k, (w + 1) * WINDOW_MS).first<{ n: number }>();
  if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM api_rate WHERE exp_ms < ?").bind(now).run();
  if ((row?.n ?? 0) > PER_WINDOW) throw new HttpError(429, "Too many directory requests. Try again in a minute.", "rate_limited");
}

export async function festivalsApi(env: Env, req: Request, url: URL) {
  await festivalsRateLimit(env, req);
  const p = url.searchParams, num = (k: string) => { const v = p.get(k); if (v == null || v === "") return undefined; const n = Number(v); if (!isFinite(n)) throw new HttpError(400, `${k} must be a number`, "invalid_param"); return n; };
  const month = num("month"); if (month != null && (!Number.isInteger(month) || month < 1 || month > 12)) throw new HttpError(400, "month must be 1-12", "invalid_param");
  const lat = num("lat"), lon = num("lon");
  if ((lat == null) !== (lon == null)) throw new HttpError(400, "lat and lon go together", "invalid_param");
  const page = Math.max(1, Math.floor(num("page") ?? 1)), per = Math.min(100, Math.max(1, Math.floor(num("per_page") ?? 25)));
  const s = (k: string, max = 80) => { const v = (p.get(k) ?? "").trim(); return v ? v.slice(0, max) : undefined; };
  const r = await searchFestivals(env, { city: s("city"), state: s("state", 10), country: s("country", 2), month, lat, lon, radius_km: num("radius_km"), q: s("q"), type: s("type", 40), limit: per, offset: (page - 1) * per });
  return { page, per_page: per, total: r.total, total_capped: r.truncated, results: r.results, note: "City-level coordinates; listed dates are mostly 2018 editions. Contact emails/phones are not published." };
}
