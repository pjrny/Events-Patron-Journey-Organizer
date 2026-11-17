/**
 * Talent Draw Estimator — GET/POST /api/talent/draw, permalinks /talent/r/:id. Deterministic, no AI.
 * Keyless now: Deezer, iTunes Search, MusicBrainz (<=1 req/s), Google News RSS, Patron Journey festival directory.
 * Plug-in adapters (on when the secret exists): LASTFM_KEY, SEATGEEK_CLIENT_ID, TICKETMASTER_KEY, BANDSINTOWN_APP_ID, GNEWS_KEY.
 * Response shape: talent-draw.v2 (docs/TALENT.md): v1 + date_effects, your-history past-draw signals, pay estimate.
 */
import type { Env } from "./env";
import { HttpError, clientIp } from "./http";
import { sha256Hex, randomToken } from "./crypto";
import { haversineKm } from "./festivals";
import { geocode, type Geo } from "./weather";
import { dateEffects } from "./date_effects";
import { cleanRows, type HistRow } from "./history";

const UA = "PatronJourney-TalentDraw/1.0 (+https://www.pjrny.com; info@pjrny.com)";
const CACHE_DAYS = 7, MAX_ARTISTS = 40, FETCH_BUDGET = 38, MB_BUDGET = 8, ROUNDS_PER_IP_PER_HOUR = 60;
const DAY = 86400000;
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const r2 = (x: number) => Math.round(x * 100) / 100, r3 = (x: number) => Math.round(x * 1000) / 1000;
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** log scale: floor -> 0, ref -> 1 */
const logN = (x: number | null | undefined, floor: number, ref: number) => x == null || !(x > 0) ? 0 : clamp((Math.log10(x) - Math.log10(floor)) / (Math.log10(ref) - Math.log10(floor)));

// ---------- Approved design constants ----------
export const BASE = { past_draw: 0.30, upcoming_demand: 0.20, tour_presence: 0.10, fan_intent: 0.15, listening: 0.15, press: 0.05, genre_fit: 0.05 } as const;
export const GEO = { city: 1.0, metro: 0.85, region: 0.6, country: 0.4, global: 0.2 } as const;
export const QUALITY = { actual_sales: 1.0, demand_score: 0.8, tracker_intent: 0.6, streaming_fans: 0.5, press_social: 0.3 } as const;
type Cat = keyof typeof BASE; type GeoL = keyof typeof GEO; type Q = keyof typeof QUALITY;
type Signal = { category: Cat; source: string; metric: string; raw: number | string | null; value: number; geo: GeoL; quality: Q; detail?: string };

// ---------- Metro populations (approx. MSA, 2024) used for the 15% cap and headliner scale ----------
const METRO: Record<string, number> = {
  "new york": 19500000, "los angeles": 12800000, chicago: 9300000, dallas: 8100000, "fort worth": 8100000, houston: 7500000, "washington": 6300000,
  philadelphia: 6200000, miami: 6200000, atlanta: 6300000, boston: 4900000, phoenix: 5100000, "san francisco": 4600000, oakland: 4600000, riverside: 4700000,
  detroit: 4300000, seattle: 4100000, minneapolis: 3700000, "san diego": 3300000, tampa: 3400000, denver: 3000000, baltimore: 2800000, "st louis": 2800000,
  orlando: 2800000, charlotte: 2800000, "san antonio": 2700000, portland: 2500000, sacramento: 2400000, pittsburgh: 2400000, austin: 2500000, "las vegas": 2400000,
  cincinnati: 2300000, "kansas city": 2200000, columbus: 2200000, indianapolis: 2100000, cleveland: 2200000, nashville: 2100000, "san jose": 2000000,
  "virginia beach": 1800000, jacksonville: 1700000, providence: 1700000, raleigh: 1500000, milwaukee: 1600000, memphis: 1300000, "oklahoma city": 1500000,
  louisville: 1400000, richmond: 1300000, "new orleans": 1300000, "salt lake city": 1300000, birmingham: 1100000, buffalo: 1200000, tulsa: 1000000, "el paso": 870000,
  albuquerque: 920000, tucson: 1060000, omaha: 980000, "corpus christi": 420000, lubbock: 330000, waco: 300000, "college station": 280000, galveston: 350000,
  toronto: 6700000, montreal: 4300000, vancouver: 2700000, london: 9600000, mexico: 21800000, "mexico city": 21800000,
};
const US_STATE: Record<string, string> = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC" };

// ---------- Fetch budget + per-source cache ----------
type Ctx = { env: Env; budget: number; mb: number; used: string[]; errors: string[] };
async function srcCache<T>(ctx: Ctx, k: string, load: () => Promise<T>, opts: { mb?: boolean } = {}): Promise<{ ok: true; v: T } | { ok: false; pending: boolean }> {
  const hit = await ctx.env.DB.prepare(`SELECT payload FROM talent_source_cache WHERE k = ? AND created_at > datetime('now', '-${CACHE_DAYS} days')`).bind(k).first<{ payload: string }>();
  if (hit) return { ok: true, v: JSON.parse(hit.payload) };
  if (ctx.budget <= 0 || (opts.mb && ctx.mb <= 0)) return { ok: false, pending: true };
  ctx.budget--; if (opts.mb) ctx.mb--;
  try {
    let v: T;
    try { v = await load(); } catch (e: any) {
      if (!/ (429|5\d\d)$|timeout|aborted/i.test(String(e?.message))) throw e;
      await new Promise((r) => setTimeout(r, 1500)); v = await load();
    }
    await ctx.env.DB.prepare("INSERT OR REPLACE INTO talent_source_cache (k, payload, created_at) VALUES (?,?,CURRENT_TIMESTAMP)").bind(k, JSON.stringify(v ?? null)).run();
    return { ok: true, v };
  } catch (e: any) {
    if (String(e?.message).includes("busy")) { ctx.budget++; if (opts.mb) ctx.mb++; return { ok: false, pending: true }; }
    ctx.errors.push(`${k.split("|")[0]}: ${String(e?.message ?? e).slice(0, 80)}`); return { ok: false, pending: false }; }
}
async function getJson(url: string, ms = 7000): Promise<any> {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(ms) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}
async function mbThrottle(env: Env) {
  for (let i = 0; i < 14; i++) {
    const now = Date.now();
    const res = await env.DB.prepare("INSERT INTO musicbrainz_throttle (id, last_ms) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET last_ms = ?1 WHERE musicbrainz_throttle.last_ms <= ?1 - 1100").bind(now).run();
    if ((res.meta?.changes ?? 0) > 0) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("musicbrainz busy");
}

// ---------- Keyless sources ----------
const sameName = (a: string, b: string) => norm(a) === norm(b);
async function deezer(ctx: Ctx, artist: string) {
  return srcCache(ctx, `deezer|${norm(artist)}`, async () => {
    const j = await getJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(artist)}&limit=5`);
    const list: any[] = j?.data ?? [];
    const a = list.find((x) => sameName(x.name, artist)) ?? null;
    return a ? { id: a.id, name: a.name, nb_fan: a.nb_fan ?? null, nb_album: a.nb_album ?? null, link: a.link, picture: a.picture_medium ?? null } : null;
  });
}
async function itunes(ctx: Ctx, artist: string) {
  return srcCache(ctx, `itunes|${norm(artist)}`, async () => {
    const j = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&entity=musicArtist&limit=5`);
    const a = (j?.results ?? []).find((x: any) => sameName(x.artistName, artist)) ?? null;
    return a ? { id: a.artistId, name: a.artistName, genre: a.primaryGenreName ?? null, link: a.artistLinkUrl } : null;
  });
}
async function musicbrainz(ctx: Ctx, artist: string) {
  return srcCache(ctx, `mb|${norm(artist)}`, async () => {
    await mbThrottle(ctx.env);
    const j = await getJson(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${artist.replace(/"/g, "")}"`)}&limit=5&fmt=json`);
    const a = (j?.artists ?? []).find((x: any) => sameName(x.name, artist) && (x.score ?? 0) >= 90) ?? null;
    if (!a) return null;
    const tags = (a.tags ?? []).sort((x: any, y: any) => (y.count ?? 0) - (x.count ?? 0)).slice(0, 8).map((t: any) => t.name);
    return { id: a.id, name: a.name, type: a.type ?? null, country: a.country ?? null, area: a.area?.name ?? null, area_type: a.area?.type ?? null, begin_area: a["begin-area"]?.name ?? null, tags };
  }, { mb: true });
}
async function googleNews(ctx: Ctx, artist: string, city: string) {
  return srcCache(ctx, `gnewsrss|${norm(artist)}|${norm(city)}`, async () => {
    const q = `"${artist.replace(/"/g, "")}" "${city}" when:90d`;
    const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(7000) });
    if (!r.ok) throw new Error(`news.google.com ${r.status}`);
    const xml = await r.text();
    const titles = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim());
    return { count: titles.length, sample: titles.slice(0, 3) };
  });
}
async function gnewsApi(ctx: Ctx, artist: string, city: string) {
  return srcCache(ctx, `gnews|${norm(artist)}|${norm(city)}`, async () => {
    const from = new Date(Date.now() - 90 * DAY).toISOString().slice(0, 19) + "Z";
    const j = await getJson(`https://gnews.io/api/v4/search?q=${encodeURIComponent(`"${artist.replace(/"/g, "")}" AND "${city}"`)}&lang=en&from=${from}&max=10&apikey=${encodeURIComponent(String(ctx.env.GNEWS_KEY))}`);
    return { count: j?.totalArticles ?? 0, sample: (j?.articles ?? []).slice(0, 3).map((a: any) => a.title) };
  });
}

// ---------- Plug-in adapters (real endpoints; off until the secret exists) ----------
async function lastfm(ctx: Ctx, artist: string) {
  return srcCache(ctx, `lastfm|${norm(artist)}`, async () => {
    const j = await getJson(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artist)}&autocorrect=1&api_key=${encodeURIComponent(String(ctx.env.LASTFM_KEY))}&format=json`);
    const a = j?.artist; if (!a) return null;
    return { name: a.name, listeners: Number(a.stats?.listeners ?? 0) || null, playcount: Number(a.stats?.playcount ?? 0) || null, tags: (a.tags?.tag ?? []).map((t: any) => t.name) };
  });
}
async function lastfmCountryTop(ctx: Ctx, country: string) {
  return srcCache(ctx, `lastfmgeo|${norm(country)}`, async () => {
    const names: string[] = [];
    for (let page = 1; page <= 2; page++) {
      const j = await getJson(`https://ws.audioscrobbler.com/2.0/?method=geo.gettopartists&country=${encodeURIComponent(country)}&limit=500&page=${page}&api_key=${encodeURIComponent(String(ctx.env.LASTFM_KEY))}&format=json`);
      for (const a of j?.topartists?.artist ?? []) names.push(norm(a.name));
    }
    return names;
  });
}
async function seatgeek(ctx: Ctx, artist: string, g: Geo) {
  return srcCache(ctx, `seatgeek|${norm(artist)}|${r2(g.lat)},${r2(g.lon)}`, async () => {
    const id = encodeURIComponent(String(ctx.env.SEATGEEK_CLIENT_ID));
    const pj = await getJson(`https://api.seatgeek.com/2/performers?q=${encodeURIComponent(artist)}&per_page=5&client_id=${id}`);
    const p = (pj?.performers ?? []).find((x: any) => sameName(x.name, artist)); if (!p) return null;
    const ej = await getJson(`https://api.seatgeek.com/2/events?performers.slug=${encodeURIComponent(p.slug)}&lat=${g.lat}&lon=${g.lon}&range=50mi&per_page=25&client_id=${id}`);
    const ev = (ej?.events ?? []).map((e: any) => ({ title: e.title, date: e.datetime_local, venue: e.venue?.name, city: e.venue?.city, score: e.score ?? null, avg_price: e.stats?.average_price ?? null, lowest_price: e.stats?.lowest_price ?? null, listings: e.stats?.listing_count ?? null }));
    return { slug: p.slug, score: p.score ?? null, has_upcoming: !!p.has_upcoming_events, upcoming_count: p.num_upcoming_events ?? null, local_events: ev };
  });
}
async function ticketmaster(ctx: Ctx, artist: string, g: Geo, stateCode: string | null) {
  return srcCache(ctx, `tm|${norm(artist)}|${r2(g.lat)},${r2(g.lon)}`, async () => {
    const k = encodeURIComponent(String(ctx.env.TICKETMASTER_KEY));
    const base = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${k}&keyword=${encodeURIComponent(artist)}&classificationName=music&size=50&sort=date,asc`;
    const local = await getJson(`${base}&latlong=${g.lat},${g.lon}&radius=50&unit=miles`);
    const shape = (e: any) => ({ name: e.name, date: e.dates?.start?.localDate ?? null, venue: e._embedded?.venues?.[0]?.name ?? null, city: e._embedded?.venues?.[0]?.city?.name ?? null, state: e._embedded?.venues?.[0]?.state?.stateCode ?? null, min: e.priceRanges?.[0]?.min ?? null, max: e.priceRanges?.[0]?.max ?? null, attraction: (e._embedded?.attractions ?? []).map((a: any) => a.name) });
    const match = (e: any) => (e._embedded?.attractions ?? []).some((a: any) => sameName(a.name, artist));
    const le = (local?._embedded?.events ?? []).filter(match).map(shape);
    let re: any[] = [];
    if (stateCode) { const rj = await getJson(`${base}&stateCode=${stateCode}&countryCode=US`); re = (rj?._embedded?.events ?? []).filter(match).map(shape); }
    return { local_events: le, region_events: re };
  });
}
async function bandsintown(ctx: Ctx, artist: string) {
  return srcCache(ctx, `bit|${norm(artist)}`, async () => {
    const id = encodeURIComponent(String(ctx.env.BANDSINTOWN_APP_ID)), n = encodeURIComponent(artist.replace(/\//g, "%252F"));
    const a = await getJson(`https://rest.bandsintown.com/artists/${n}?app_id=${id}`); if (!a || a.error) return null;
    const ev = (await getJson(`https://rest.bandsintown.com/artists/${n}/events?app_id=${id}&date=upcoming`)) ?? [];
    return { name: a.name, tracker_count: a.tracker_count ?? null, upcoming_event_count: a.upcoming_event_count ?? null,
      events: (Array.isArray(ev) ? ev : []).slice(0, 100).map((e: any) => ({ date: e.datetime, city: e.venue?.city, region: e.venue?.region, country: e.venue?.country, lat: Number(e.venue?.latitude) || null, lon: Number(e.venue?.longitude) || null, venue: e.venue?.name })) };
  });
}

// ---------- Genre fit from Oscar's festival directory ----------
const GENRE_SYN: Record<string, string[]> = {
  "hip hop": ["hip hop", "hip-hop", "rap", "trap"], rap: ["hip hop", "hip-hop", "rap"], electronic: ["electronic", "edm", "house", "techno", "dance", "trance", "dubstep", "bass"], dance: ["edm", "electronic", "house", "dance"],
  rock: ["rock", "indie", "alternative", "punk", "metal"], alternative: ["alternative", "indie", "rock"], indie: ["indie", "alternative", "rock"], country: ["country", "americana", "bluegrass"],
  "r&b": ["r&b", "rnb", "soul"], soul: ["soul", "r&b", "funk"], jazz: ["jazz", "blues"], blues: ["blues", "jazz"], latin: ["latin", "reggaeton", "tejano", "salsa"], pop: ["pop"], reggae: ["reggae", "dub"], folk: ["folk", "americana"], metal: ["metal", "rock"], funk: ["funk", "soul"],
};
function genreKeys(tags: string[]): string[] {
  const out = new Set<string>();
  for (const t of tags) { const n = t.toLowerCase(); for (const [k, syn] of Object.entries(GENRE_SYN)) if (n.includes(k) || syn.some((s) => n.includes(s))) syn.forEach((s) => out.add(s)); }
  return [...out];
}
type DirRow = { subcategory: string | null; category: string | null; month: number | null; attendance: number | null; lat: number | null; lon: number | null };
async function directory(env: Env, g: Geo): Promise<DirRow[]> {
  const R = 100, dLat = R / 111, dLon = R / (111 * Math.max(0.05, Math.cos((g.lat * Math.PI) / 180)));
  const rows = (await env.DB.prepare("SELECT subcategory, category, month, attendance, lat, lon FROM festival_directory WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT 5000")
    .bind(g.lat - dLat, g.lat + dLat, g.lon - dLon, g.lon + dLon).all<DirRow>()).results ?? [];
  return rows.filter((r) => r.lat != null && haversineKm(g.lat, g.lon, r.lat!, r.lon!) <= R);
}
function genreFit(dir: DirRow[], keys: string[], month: number | null) {
  const music = dir.filter((r) => (r.category ?? "").toLowerCase() === "music" && r.subcategory && !r.subcategory.startsWith("~"));
  if (music.length < 3 || !keys.length) return null;
  const hit = (r: DirRow) => keys.some((k) => (r.subcategory ?? "").toLowerCase().includes(k));
  const m = music.filter(hit).length, mm = month ? music.filter((r) => r.month === month) : [], mh = mm.filter(hit).length;
  const share = m / music.length;
  return { matched: m, music_listings: music.length, same_month_matched: mh, same_month_music: mm.length, share: r3(share), value: r3(clamp(share * 1.5 + (mh ? 0.1 : 0))) };
}

// ---------- Lineup parsing ----------
export function parseLineup(text: string): { name: string; fee: number | null }[] {
  const t = String(text ?? "").slice(0, 8000);
  const parts = t.split(/\r?\n/).flatMap((l) => (/[|\t=]\s*\$?\s*[\d,.]+\s*k?\s*$/i.test(l) && !/[;]/.test(l) && l.split(",").length <= 2 ? [l] : l.split(/[,;]+/))).map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>(), out: { name: string; fee: number | null }[] = [];
  for (const p of parts) {
    const m = p.match(/^(.*?)\s*(?:\||\t|=)\s*\$?\s*([\d,.]+)\s*(k)?\s*$/i);
    let name = (m ? m[1] : p).replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "").trim().slice(0, 100);
    const fee = m ? Number(m[2].replace(/,/g, "")) * (m[3] ? 1000 : 1) : null;
    if (!name || seen.has(norm(name))) continue; seen.add(norm(name));
    out.push({ name, fee: fee != null && isFinite(fee) && fee > 0 ? fee : null });
    if (out.length >= MAX_ARTISTS) break;
  }
  return out;
}

// ---------- Per-artist scoring ----------
type Place = { g: Geo; cityKey: string; state: string | null; stateCode: string | null; country: string | null; pop: number; popKnown: boolean };
function eff(s: Signal) { return BASE[s.category] * GEO[s.geo] * QUALITY[s.quality]; }

async function artistSignals(ctx: Ctx, name: string, place: Place, dir: DirRow[], month: number | null, eventGenre: string | null) {
  const env = ctx.env, sig: Signal[] = [], facts: any = {}; let pending = false;
  const take = <T,>(r: { ok: true; v: T } | { ok: false; pending: boolean }): T | null => { if (r.ok) return r.v; if (r.pending) pending = true; return null; };
  const [dz, it, news] = await Promise.all([deezer(ctx, name), itunes(ctx, name), env.GNEWS_KEY ? gnewsApi(ctx, name, place.g.city ?? place.cityKey) : googleNews(ctx, name, place.g.city ?? place.cityKey)]);
  const d = take(dz), i = take(it), n = take(news);
  const mb = take(await musicbrainz(ctx, name));
  facts.deezer = d; facts.itunes = i; facts.musicbrainz = mb; facts.found = !!(d || i || mb);
  if (d?.nb_fan != null) sig.push({ category: "listening", source: "Deezer", metric: "fans (worldwide)", raw: d.nb_fan, value: r3(logN(d.nb_fan, 300, 5e6)), geo: "global", quality: "streaming_fans" });
  if (n) sig.push({ category: "press", source: env.GNEWS_KEY ? "GNews" : "Google News RSS", metric: `articles with "${name}" + "${place.g.city ?? place.cityKey}", last 90 days`, raw: n.count, value: r3(clamp(Math.log1p(n.count) / Math.log1p(100))), geo: "city", quality: "press_social", detail: n.sample?.[0] ?? undefined });
  // Local roots (MusicBrainz area): weak tour-presence evidence
  if (mb?.area || mb?.begin_area || mb?.country) {
    const areas = [mb.area, mb.begin_area].filter(Boolean).map((x: string) => norm(x));
    const cityN = norm(place.g.city ?? place.cityKey), stN = place.state ? norm(place.state) : "";
    if (areas.includes(cityN)) sig.push({ category: "tour_presence", source: "MusicBrainz", metric: "hometown / based in", raw: [mb.area, mb.begin_area].find((x: string) => x && norm(x) === cityN) ?? mb.area, value: 0.8, geo: "city", quality: "press_social", detail: "Local act: home crowd" });
    else if (stN && areas.includes(stN)) sig.push({ category: "tour_presence", source: "MusicBrainz", metric: "based in state", raw: mb.area, value: 0.7, geo: "region", quality: "press_social" });
    else if (mb.country && place.country && mb.country === place.country) sig.push({ category: "tour_presence", source: "MusicBrainz", metric: "same country", raw: mb.country, value: 0.3, geo: "country", quality: "press_social" });
    else if (mb.country) sig.push({ category: "tour_presence", source: "MusicBrainz", metric: "based abroad", raw: mb.country, value: 0.15, geo: "country", quality: "press_social" });
  }
  // Genre fit (directory)
  const tags = [...(mb?.tags ?? []), ...(i?.genre ? [i.genre] : [])];
  facts.genres = [...new Set(tags)].slice(0, 6);
  const gf = genreFit(dir, genreKeys(tags), month);
  if (gf) {
    let v = gf.value;
    if (eventGenre) { const ek = genreKeys([eventGenre]); if (ek.length && genreKeys(tags).some((k) => ek.includes(k))) v = clamp(v + 0.2); }
    sig.push({ category: "genre_fit", source: "Patron Journey festival directory", metric: "share of music festivals within 100 km in this artist's genre", raw: `${gf.matched}/${gf.music_listings}`, value: r3(v), geo: "metro", quality: "streaming_fans", detail: month ? `${gf.same_month_matched} of ${gf.same_month_music} in the same month` : undefined });
  }
  // ---- Adapters ----
  if (env.LASTFM_KEY) {
    const lf = take(await lastfm(ctx, name));
    if (lf?.listeners) sig.push({ category: "listening", source: "Last.fm", metric: "listeners (worldwide)", raw: lf.listeners, value: r3(logN(lf.listeners, 1000, 4e6)), geo: "global", quality: "streaming_fans" });
    const cn = countryName(place.country);
    if (cn) { const top = take(await lastfmCountryTop(ctx, cn)); if (top) { const rank = top.indexOf(norm(name)) + 1; sig.push({ category: "listening", source: "Last.fm", metric: `rank in ${cn} top 1,000`, raw: rank || null, value: rank ? r3(clamp(1 - Math.log10(rank) / 3)) : 0, geo: "country", quality: "streaming_fans" }); } }
  }
  if (env.SEATGEEK_CLIENT_ID) {
    const sg = take(await seatgeek(ctx, name, place.g));
    if (sg) {
      if (sg.score != null) sig.push({ category: "upcoming_demand", source: "SeatGeek", metric: "performer demand score (0-1)", raw: sg.score, value: r3(clamp(sg.score / 0.75)), geo: "global", quality: "demand_score" });
      const loc = (sg.local_events ?? []).filter((e: any) => e.score != null);
      if (loc.length) { const top = loc.reduce((a: any, b: any) => (b.score > a.score ? b : a)); sig.push({ category: "upcoming_demand", source: "SeatGeek", metric: "best upcoming event score within 50 mi", raw: top.score, value: r3(clamp(top.score / 0.75)), geo: "metro", quality: "demand_score", detail: `${top.venue ?? ""} ${top.date?.slice(0, 10) ?? ""}${top.avg_price ? ` avg $${top.avg_price}` : ""}` }); facts.price_hint = top.avg_price ?? top.lowest_price ?? facts.price_hint; }
    }
  }
  if (env.TICKETMASTER_KEY) {
    const tm = take(await ticketmaster(ctx, name, place.g, place.stateCode));
    if (tm) {
      if (tm.local_events.length) {
        const mins = tm.local_events.map((e: any) => e.min).filter((x: any) => x != null);
        sig.push({ category: "tour_presence", source: "Ticketmaster", metric: "upcoming shows within 50 mi", raw: tm.local_events.length, value: 1, geo: "metro", quality: "tracker_intent", detail: `${tm.local_events[0].venue ?? ""} ${tm.local_events[0].date ?? ""}` });
        if (mins.length) { const med = mins.sort((a: number, b: number) => a - b)[Math.floor(mins.length / 2)]; sig.push({ category: "upcoming_demand", source: "Ticketmaster", metric: "median face-value minimum price, local shows", raw: med, value: r3(logN(med, 15, 150)), geo: "metro", quality: "demand_score" }); facts.price_hint = facts.price_hint ?? med; }
      } else if (tm.region_events.length) sig.push({ category: "tour_presence", source: "Ticketmaster", metric: `upcoming shows elsewhere in ${place.stateCode}`, raw: tm.region_events.length, value: 0.6, geo: "region", quality: "tracker_intent", detail: "Playing the region but not this metro (radius clause risk)" });
      else sig.push({ category: "tour_presence", source: "Ticketmaster", metric: "no upcoming shows in metro or state", raw: 0, value: 0.3, geo: "region", quality: "tracker_intent" });
    }
  }
  if (env.BANDSINTOWN_APP_ID) {
    const bt = take(await bandsintown(ctx, name));
    if (bt) {
      if (bt.tracker_count != null) sig.push({ category: "fan_intent", source: "Bandsintown", metric: "trackers (worldwide)", raw: bt.tracker_count, value: r3(logN(bt.tracker_count, 500, 2e6)), geo: "global", quality: "tracker_intent" });
      const near = (bt.events ?? []).filter((e: any) => e.lat != null && haversineKm(place.g.lat, place.g.lon, e.lat, e.lon) <= 80);
      if (near.length) sig.push({ category: "tour_presence", source: "Bandsintown", metric: "upcoming shows within 50 mi", raw: near.length, value: 1, geo: "metro", quality: "tracker_intent", detail: `${near[0].venue ?? ""} ${String(near[0].date ?? "").slice(0, 10)}` });
      else if (bt.upcoming_event_count) sig.push({ category: "tour_presence", source: "Bandsintown", metric: "touring, but not near this city", raw: bt.upcoming_event_count, value: 0.4, geo: "country", quality: "tracker_intent" });
    }
  }
  return { sig, facts, pending };
}
function countryName(cc: string | null) { if (!cc) return null; try { return new Intl.DisplayNames(["en"], { type: "region" }).of(cc) ?? null; } catch { return cc === "US" ? "United States" : null; } }

function scoreArtist(sig: Signal[]) {
  // Per category: average the signals' values weighted by their geo x quality discount; category weight = base x best discount.
  const cats: any = {}; let wSum = 0, vSum = 0;
  for (const c of Object.keys(BASE) as Cat[]) {
    const ss = sig.filter((s) => s.category === c); if (!ss.length) { cats[c] = null; continue; }
    const ds = ss.map((s) => GEO[s.geo] * QUALITY[s.quality]), dsum = ds.reduce((a, b) => a + b, 0);
    const v = ss.reduce((a, s, k) => a + s.value * ds[k], 0) / dsum, w = BASE[c] * Math.max(...ds);
    cats[c] = { value: r3(v), effective_weight: r3(w) }; wSum += w; vSum += w * v;
  }
  for (const c of Object.keys(cats)) if (cats[c]) cats[c].share = r3(cats[c].effective_weight / wSum);
  // Context signals (press, genre fit, local roots) scale demand but cannot create it: gate by the popularity categories.
  const P: Cat[] = ["past_draw", "upcoming_demand", "fan_intent", "listening"];
  let pw = 0, pv = 0; for (const c of P) if (cats[c]) { pw += cats[c].effective_weight; pv += cats[c].effective_weight * cats[c].value; }
  const popularity = pw ? pv / pw : 0;
  return { score: wSum ? r3(vSum / wSum) : 0, popularity: r3(popularity), gate: r3(clamp(0.05 + 1.6 * popularity)), confidence: r3(wSum), categories: cats };
}
const confLabel = (c: number) => (c < 0.08 ? "Very low" : c < 0.2 ? "Low" : c < 0.4 ? "Medium" : "High");
const spread = (c: number) => clamp(0.15 + 0.7 * (1 - Math.min(1, c / 0.5)), 0.15, 0.85);

// ---------- Your history -> past draw ----------
/** Solve v in [0,1] so that, on its own, the model reproduces the tickets you sold: H * v^3 * gate(v) = tickets. */
function pastDrawValue(tickets: number, H: number) {
  const target = tickets / H; if (target <= 0) return 0;
  let lo = 0, hi = 1;
  for (let k = 0; k < 40; k++) { const v = (lo + hi) / 2, f = v ** 3 * clamp(0.05 + 1.6 * v); if (f < target) lo = v; else hi = v; }
  return clamp((lo + hi) / 2);
}
function historyFor(hist: HistRow[], name: string, place: Place, H: number, refDate: string | null) {
  const n = norm(name), now = refDate ? Date.parse(refDate) : Date.now();
  const mine = hist.filter((h) => norm(h.artist) === n).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const sig: Signal[] = [];
  for (const h of mine.filter((x) => x.tickets_sold != null).slice(0, 5)) {
    const ageY = h.date ? (now - Date.parse(h.date)) / (365.25 * DAY) : null;
    if (ageY != null && ageY > 5) continue;
    const age = ageY != null && ageY > 3 ? 0.85 : 1;
    const [cRaw, sRaw] = (h.city ?? "").split(",").map((x) => x.trim());
    const ck = norm(cRaw ?? ""), sk = sRaw ? sRaw.toUpperCase() : "";
    const geo: GeoL = !ck ? "country" : ck === place.cityKey ? "city"
      : METRO[ck] && METRO[ck] === METRO[place.cityKey] ? "metro"
      : place.stateCode && (sk === place.stateCode || US_STATE[norm(sRaw ?? "")] === place.stateCode) ? "region" : "country";
    const tix = h.tickets_sold! * age;
    sig.push({ category: "past_draw", source: "Your history", metric: `tickets sold${h.capacity ? ` (of ${h.capacity.toLocaleString("en-US")} cap)` : ""}`, raw: h.tickets_sold, value: r3(pastDrawValue(tix, H)), geo, quality: "actual_sales",
      detail: [h.date, h.venue, h.city, h.capacity ? `${Math.round((100 * h.tickets_sold!) / h.capacity)}% sold` : null, age < 1 ? "3-5 yrs old: x0.85" : null].filter(Boolean).join(" · ") });
  }
  const fees = mine.filter((h) => h.fee_paid != null).slice(0, 5).map((h) => ({ fee: h.fee_paid!, date: h.date, city: h.city, tickets_sold: h.tickets_sold, per_ticket: h.tickets_sold ? Math.round((100 * h.fee_paid!) / h.tickets_sold) / 100 : null }));
  return { sig, fees, rows: mine.length };
}

// ---------- Core ----------
export type DrawInput = { lineup: string; city: string; date: string | null; end_date?: string | null; capacity: number | null; genre: string | null; price: number | null; budget?: number | null; history?: any };
export async function talentDraw(env: Env, req: Request, inp: DrawInput) {
  const artists = parseLineup(inp.lineup);
  if (!artists.length) throw new HttpError(400, "Paste at least one artist (one per line, or comma separated).", "missing_lineup");
  const city = (inp.city ?? "").trim();
  if (city.length < 2 || city.length > 120) throw new HttpError(400, "Enter the event city (e.g. 'Austin, TX').", "invalid_city");
  let month: number | null = null;
  if (inp.date) { if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.date) || isNaN(Date.parse(inp.date))) throw new HttpError(400, "date must be YYYY-MM-DD", "invalid_date"); month = Number(inp.date.slice(5, 7)); }
  const capacity = inp.capacity != null && isFinite(inp.capacity) && inp.capacity > 0 ? Math.min(2_000_000, Math.round(inp.capacity)) : null;
  const price = inp.price != null && isFinite(inp.price) && inp.price > 0 ? Math.min(5000, inp.price) : null;
  const genre = inp.genre?.trim().slice(0, 60) || null;
  const budget = inp.budget != null && isFinite(inp.budget) && inp.budget > 0 ? Math.min(1e9, Math.round(inp.budget)) : null;
  const endDate = inp.end_date && /^\d{4}-\d{2}-\d{2}$/.test(inp.end_date) && inp.date && inp.end_date >= inp.date ? inp.end_date : null;
  const hist = cleanRows(inp.history);
  const histHash = hist.length ? (await sha256Hex(JSON.stringify(hist))).slice(0, 16) : "";
  // Results that use your private history or budget are never cached for others or given a public permalink.
  const isPrivate = hist.length > 0 || budget != null;

  const cacheKey = `v2|${norm(city)}|${inp.date ?? ""}|${endDate ?? ""}|${capacity ?? ""}|${norm(genre ?? "")}|${price ?? ""}|${artists.map((a) => norm(a.name) + ":" + (a.fee ?? "")).join(",")}`;
  const hit = isPrivate ? null : await env.DB.prepare(`SELECT payload FROM talent_results WHERE cache_key = ? AND created_at > datetime('now', '-${CACHE_DAYS} days') ORDER BY created_at DESC LIMIT 1`).bind(cacheKey).first<{ payload: string }>();
  if (hit) return { ...JSON.parse(hit.payload), cached: true };

  // Rate limit (per IP, per hour, uncached rounds)
  const ipHash = await sha256Hex("talent-ip:" + (clientIp(req) ?? "unknown"));
  const HOUR = 3600000, w = Math.floor(Date.now() / HOUR);
  const rl = await env.DB.prepare("INSERT INTO api_rate (k, n, exp_ms) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n").bind(`talent|${ipHash}|${w}`, (w + 1) * HOUR).first<{ n: number }>();
  if ((rl?.n ?? 0) > ROUNDS_PER_IP_PER_HOUR) throw new HttpError(429, "Too many lineup checks from this network. Try again in an hour.", "rate_limited");

  const g = await geocode(env, city);
  const cityKey = norm(g.city ?? city.split(",")[0]);
  const pop0 = METRO[cityKey] ?? METRO[norm(city.split(",")[0])];
  const st = g.state ? norm(g.state) : null;
  const place: Place = { g, cityKey, state: g.state, stateCode: g.country_code === "US" && st ? US_STATE[st] ?? null : null, country: g.country_code, pop: pop0 ?? 1_000_000, popKnown: !!pop0 };
  const dir = await directory(env, g);
  const ctx: Ctx = { env, budget: FETCH_BUDGET, mb: MB_BUDGET, used: [], errors: [] };

  const rows: any[] = []; let pendingCount = 0;
  for (let k = 0; k < artists.length; k += 4) {
    const batch = artists.slice(k, k + 4);
    const res = await Promise.all(batch.map((a) => artistSignals(ctx, a.name, place, dir, month, genre)));
    res.forEach((r, j) => { if (r.pending) pendingCount++; rows.push({ a: batch[j], ...r }); });
  }
  if (pendingCount) return { schema: "talent-draw.v2", ok: true, incomplete: true, pending: pendingCount, total: artists.length, message: `Looked up ${artists.length - pendingCount} of ${artists.length} artists; continuing…` };

  // Headliner scale: draw of a score-1.0 act in this market (attendees primarily drawn).
  const H = Math.round(clamp(place.pop * 0.006, 2500, 60000));
  const histBy = new Map<string, ReturnType<typeof historyFor>>();
  for (const r of rows) { const hh = historyFor(hist, r.a.name, place, H, inp.date); histBy.set(r.a.name, hh); r.sig.push(...hh.sig); }
  const scored: any[] = rows.map((r) => {
    const s = scoreArtist(r.sig);
    const draw = Math.round(H * Math.pow(s.score, 3) * s.gate);
    const sp = spread(s.confidence);
    return { name: r.a.name, fee: r.a.fee, found: r.facts.found, score: s.score, popularity: s.popularity, popularity_gate: s.gate, confidence: s.confidence, confidence_label: confLabel(s.confidence),
      draw: { mid: draw, low: Math.round(draw * (1 - sp)), high: Math.round(draw * (1 + sp)) }, categories: s.categories,
      signals: r.sig.map((x: Signal) => ({ ...x, base_weight: BASE[x.category], geo_discount: GEO[x.geo], quality_discount: QUALITY[x.quality], effective_weight: r3(eff(x)) })),
      genres: r.facts.genres, hometown: r.facts.musicbrainz?.area ?? null, country: r.facts.musicbrainz?.country ?? null,
      links: { deezer: r.facts.deezer?.link ?? null, apple_music: r.facts.itunes?.link ?? null, musicbrainz: r.facts.musicbrainz ? `https://musicbrainz.org/artist/${r.facts.musicbrainz.id}` : null }, picture: r.facts.deezer?.picture ?? null, price_hint: r.facts.price_hint ?? null,
      history: { rows: histBy.get(r.a.name)?.rows ?? 0, past_fees: histBy.get(r.a.name)?.fees ?? [] } };
  }).sort((a, b) => b.draw.mid - a.draw.mid || b.score - a.score);

  // Lineup total: headliner-weighted decay (1, 1/2, 1/3, ...) sorted by draw.
  let mid = 0, lo = 0, hi = 0;
  scored.forEach((s: any, idx) => { const f = 1 / (idx + 1); s.rank = idx + 1; s.decay = r3(f); s.contribution = Math.round(s.draw.mid * f); mid += s.draw.mid * f; lo += s.draw.low * f; hi += s.draw.high * f; });
  // Price adjustment vs market price hint (or $65 default): mild elasticity.
  const hints = scored.map((s: any) => s.price_hint).filter((x: any) => x != null);
  const ref = hints.length ? hints.sort((a: number, b: number) => a - b)[Math.floor(hints.length / 2)] : 65;
  const priceFactor = price ? r3(clamp(Math.pow(ref / price, 0.35), 0.6, 1.3)) : 1;
  mid *= priceFactor; lo *= priceFactor; hi *= priceFactor;
  // Date effects (weekday / public holiday / going-out & stay-in days + competition): docs/DATE_EFFECTS.md
  const de = inp.date ? await dateEffects(env, inp.date, endDate, g.country_code ?? "US").catch(() => null) : null;
  const dm = de?.net_multiplier ?? 1;
  mid *= dm; lo *= dm; hi *= dm;
  const popCap = Math.round(place.pop * 0.15), caps = [popCap, ...(capacity ? [capacity] : [])], cap = Math.min(...caps);
  const capped = hi > cap;
  const tot = { low: Math.round(Math.min(lo, cap)), mid: Math.round(Math.min(mid, cap)), high: Math.round(Math.min(hi, cap)) };
  const totW = scored.reduce((a: number, s: any) => a + s.contribution, 0) || 1;
  const conf = scored.length ? r3(scored.slice(0, 5).reduce((a: number, s: any, k) => a + s.confidence / (k + 1), 0) / scored.slice(0, 5).reduce((a: number, _s: any, k) => a + 1 / (k + 1), 0)) : 0;

  const feed: string[] = [];
  const top = scored[0];
  if (top) feed.push(`${top.name} carries ${Math.round((100 * top.contribution) / totW)}% of the lineup's draw (est. ${top.draw.low.toLocaleString("en-US")}–${top.draw.high.toLocaleString("en-US")} primarily for them).`);
  const locals = scored.filter((s: any) => s.signals.some((x: any) => x.source === "MusicBrainz" && x.geo === "city"));
  if (locals.length) feed.push(`Local act${locals.length > 1 ? "s" : ""}: ${locals.slice(0, 4).map((s: any) => s.name).join(", ")} — home crowd bump.`);
  const buzz = scored.filter((s: any) => s.signals.some((x: any) => x.category === "press" && Number(x.raw) >= 5));
  if (buzz.length) feed.push(`Local press buzz in the last 90 days: ${buzz.slice(0, 4).map((s: any) => s.name).join(", ")}.`);
  const missing = scored.filter((s: any) => !s.found);
  if (missing.length) feed.push(`No match found for ${missing.slice(0, 5).map((s: any) => s.name).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""} — check spelling; counted as ~0 draw.`);
  if (capped) feed.push(`Upper range capped at ${cap.toLocaleString("en-US")} (${capacity && cap === capacity ? "your capacity" : "~15% of metro population"}).`);
  if (capacity && tot.mid < capacity * 0.5) feed.push(`Lineup alone fills about ${Math.round((100 * tot.mid) / capacity)}% of capacity; the rest has to come from the event brand, marketing and walk-ups.`);
  if (de) feed.push(`Date effect: ${de.summary}${de.days.flatMap((d: any) => d.signals.filter((x: any) => x.kind !== "weekday" && x.kind !== "info").map((x: any) => x.label)).length ? ` (${[...new Set(de.days.flatMap((d: any) => d.signals.filter((x: any) => x.kind !== "weekday" && x.kind !== "info").map((x: any) => x.label)))].join(", ")})` : ""}.`);
  else feed.push("No event date given, so no weekday or holiday effect is applied.");
  const withHist = scored.filter((s: any) => s.signals.some((x: any) => x.source === "Your history"));
  if (withHist.length) feed.push(`Your history fills "past draw" for ${withHist.slice(0, 5).map((s: any) => s.name).join(", ")}${withHist.length > 5 ? ` and ${withHist.length - 5} more` : ""}.`);
  if (price && priceFactor !== 1) feed.push(`Ticket price $${price} vs ~$${Math.round(ref)} market reference adjusts draw ×${priceFactor}.`);
  feed.push(`Confidence: ${confLabel(conf)} (${Math.round(conf * 100)}% of the full signal weight). ${conf < 0.2 ? "Mostly global data, heavily discounted — add ticketing keys for local demand." : ""}`.trim());

  // ---------- Artist pay estimate (docs/TALENT.md#pay) ----------
  const histTix = hist.filter((h) => h.gross != null && h.tickets_sold);
  const histPrice = histTix.length ? Math.round((100 * histTix.reduce((a, h) => a + h.gross!, 0)) / histTix.reduce((a, h) => a + h.tickets_sold!, 0)) / 100 : null;
  const payPrice = price ?? histPrice ?? (hints.length ? Math.round(ref) : null);
  const payPriceSrc = price ? "your ticket price" : histPrice ? "average ticket price in your history (gross / tickets sold)" : hints.length ? "median local face value from ticketing sources" : null;
  const SHARE = [0.3, 0.5] as const;
  const round50 = (x: number) => Math.round(x / 50) * 50;
  const totC = scored.reduce((a: number, s: any) => a + s.contribution, 0);
  const perPay = scored.map((s: any) => {
    const share = totC ? s.contribution / totC : 0;
    const tickets = Math.round(tot.mid * share);
    const suggested = budget != null && totC ? round50(budget * share) : null;
    const mLow = payPrice ? round50(tickets * payPrice * SHARE[0]) : null, mHigh = payPrice ? round50(tickets * payPrice * SHARE[1]) : null;
    const flags: string[] = [];
    if (!s.contribution) flags.push("No draw estimate for this act; price it by hand.");
    if (s.fee != null && mHigh != null && s.fee > mHigh) flags.push(`Your fee $${s.fee.toLocaleString("en-US")} is above the market range for this draw.`);
    if (s.fee != null && mLow != null && s.fee < mLow && s.contribution) flags.push(`Your fee $${s.fee.toLocaleString("en-US")} is below the market range; double-check the offer will land.`);
    if (suggested != null && mHigh != null && suggested > mHigh) flags.push("Budget share is above what this act's draw supports.");
    if (suggested != null && mLow != null && suggested < mLow && s.contribution) flags.push("Budget share is below the typical range; it may not be enough to book this act.");
    const pf = s.history?.past_fees ?? [];
    const lastFee = pf.length ? pf[0].fee : null;
    if (lastFee != null && suggested != null && suggested < lastFee * 0.67) flags.push(`You paid $${lastFee.toLocaleString("en-US")} last time; this budget share is well below that.`);
    if (lastFee != null && s.fee != null && s.fee > lastFee * 1.5) flags.push(`Your fee is over 1.5× the $${lastFee.toLocaleString("en-US")} you paid last time.`);
    return { name: s.name, rank: s.rank, draw_share: r3(share), attributable_tickets: tickets, suggested_fee: suggested, market_low: mLow, market_high: mHigh, entered_fee: s.fee ?? null, past_fees: pf, flags };
  });
  const sum = (f: (x: any) => number | null) => perPay.reduce((a, x) => a + (f(x) ?? 0), 0);
  const entered = scored.some((s: any) => s.fee != null) ? sum((x) => x.entered_fee) : null;
  const mLowT = payPrice ? sum((x) => x.market_low) : null, mHighT = payPrice ? sum((x) => x.market_high) : null;
  const payFlags: string[] = [];
  if (budget != null && entered != null) payFlags.push(entered > budget ? `Entered fees $${entered.toLocaleString("en-US")} are $${(entered - budget).toLocaleString("en-US")} over your budget.` : `Entered fees $${entered.toLocaleString("en-US")} leave $${(budget - entered).toLocaleString("en-US")} of your budget.`);
  if (budget != null && mHighT != null && budget > mHighT) payFlags.push(`Budget $${budget.toLocaleString("en-US")} is above ${Math.round(SHARE[1] * 100)}% of the expected gross ($${mHighT.toLocaleString("en-US")}); this lineup's draw may not pay it back.`);
  if (budget != null && mLowT != null && budget < mLowT) payFlags.push(`Budget $${budget.toLocaleString("en-US")} is below ${Math.round(SHARE[0] * 100)}% of the expected gross ($${mLowT.toLocaleString("en-US")}); offers may be too low to book these acts.`);
  if (!payPrice) payFlags.push("Add a ticket price to see the market range.");
  const pay = {
    budget, ticket_price: payPrice, ticket_price_source: payPriceSrc, talent_share_of_gross: SHARE,
    expected_gross: payPrice ? Math.round(tot.mid * payPrice) : null,
    totals: { suggested: budget, entered, market_low: mLowT, market_high: mHighT },
    per_artist: perPay, flags: payFlags,
    method: "suggested_fee = budget x draw share (draw share = headliner-weighted contribution / lineup total; rounded to $50). market range = attributable tickets x ticket price x 30-50% (typical talent share of gross).",
  };

  const sd = Math.round((tot.high - tot.low) / 3.29);
  const id = "td_" + randomToken(9).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12);
  const enabled = { lastfm: !!env.LASTFM_KEY, seatgeek: !!env.SEATGEEK_CLIENT_ID, ticketmaster: !!env.TICKETMASTER_KEY, bandsintown: !!env.BANDSINTOWN_APP_ID, gnews: !!env.GNEWS_KEY };
  const result = {
    schema: "talent-draw.v2", ok: true, id: isPrivate ? null : id, permalink: isPrivate ? null : `/talent/r/${id}`, private: isPrivate, generated_at: new Date().toISOString(), cached: false,
    input: { city, date: inp.date, end_date: endDate, budget, history_rows: hist.length, capacity, genre, ticket_price: price, artists: artists.map((a) => ({ name: a.name, fee: a.fee })) },
    location: { city: g.city, state: g.state, country: g.country_code, lat: Math.round(g.lat * 1e4) / 1e4, lon: Math.round(g.lon * 1e4) / 1e4, metro_population: place.pop, metro_population_known: place.popKnown },
    headline: `${top ? top.name : "Lineup"}${scored.length > 1 ? ` + ${scored.length - 1} more` : ""} in ${g.city ?? city}: ${tot.low.toLocaleString("en-US")}–${tot.high.toLocaleString("en-US")} expected draw`,
    lineup_total: { ...tot, cap, capped, price_factor: priceFactor, date_multiplier: dm, headliner_scale: H, method: "draw_i = headliner_scale x score^3 x popularity_gate; total = sum(draw_i / rank_i) over artists sorted by draw, x price factor x date multiplier, capped by min(capacity, 15% metro population)" },
    confidence: { value: conf, label: confLabel(conf), range_spread: r3(spread(conf)) },
    artists: scored, feed, date_effects: de, pay,
    simulator: {
      attendance_base: tot, attendance_sd: sd, replace_flat_attendance: true,
      per_artist: scored.map((s: any) => ({ name: s.name, rank: s.rank, contribution: s.contribution, fee: s.fee, cost_per_expected_ticket: s.fee && s.contribution ? Math.round((100 * s.fee) / s.contribution) / 100 : null })),
      lineup_cost: scored.some((s: any) => s.fee) ? scored.reduce((a: number, s: any) => a + (s.fee ?? 0), 0) : null,
      cost_per_expected_ticket: scored.some((s: any) => s.fee) && tot.mid ? Math.round((100 * scored.reduce((a: number, s: any) => a + (s.fee ?? 0), 0)) / tot.mid) / 100 : null,
    },
    weights: { base: BASE, geo_discount: GEO, quality_discount: QUALITY },
    sources_enabled: { deezer: true, itunes: true, musicbrainz: true, google_news_rss: !env.GNEWS_KEY, festival_directory: true, ...enabled },
    disclaimer: "These are proxies, not ticket sales. Spotify does not expose city-level streams, and no public API gives followers by city. Worldwide numbers (Deezer fans, Last.fm listeners, Bandsintown trackers) are discounted to 20%. 'Past draw in this market' comes only from historic shows you add (your own ticket sales); without them, ranges are wide. Date effects and the pay range are planning assumptions, not measured data.",
    notes: [...(place.popKnown ? [] : ["Metro population unknown for this city; assumed 1,000,000 for scale and the 15% cap."]), ...(ctx.errors.length ? [`Some lookups failed and were skipped: ${[...new Set(ctx.errors)].slice(0, 4).join("; ")}.`] : [])],
    links: { plan_free: "/dashboard", paid: env.PAID_UPGRADE_URL || "https://www.pjrny.com/#Contact-us" },
  };
  // Partial results (a source failed) get a permalink but are not reused as the 7-day cache.
  if (!isPrivate) await env.DB.prepare("INSERT INTO talent_results (id, cache_key, payload, ip_hash) VALUES (?,?,?,?)").bind(id, ctx.errors.length ? "partial|" + cacheKey : cacheKey, JSON.stringify(result), ipHash).run();
  return result;
}

export async function getTalentResult(env: Env, id: string): Promise<any | null> {
  if (!/^td_[A-Za-z0-9_-]{6,40}$/.test(id)) return null;
  const r = await env.DB.prepare("SELECT payload FROM talent_results WHERE id = ?").bind(id).first<{ payload: string }>();
  return r ? JSON.parse(r.payload) : null;
}

export async function talentApi(env: Env, req: Request, url: URL) {
  let b: any = {};
  if (req.method === "POST") {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) b = await req.json().catch(() => { throw new HttpError(400, "Invalid JSON", "invalid_json"); });
    else { const fd = await req.formData().catch(() => null); if (fd) for (const [k, v] of fd) b[k] = String(v); }
  } else for (const [k, v] of url.searchParams) b[k] = v;
  const num = (v: any) => (v == null || v === "" ? null : Number(String(v).replace(/[$,]/g, "")));
  const lineup = Array.isArray(b.lineup) ? b.lineup.join("\n") : String(b.lineup ?? "");
  let history = b.history;
  if (typeof history === "string") { try { history = JSON.parse(history); } catch { history = null; } }
  return talentDraw(env, req, { lineup, city: String(b.city ?? ""), date: b.date ? String(b.date) : null, end_date: b.end_date ? String(b.end_date) : null, capacity: num(b.capacity), genre: b.genre ? String(b.genre) : null, price: num(b.price ?? b.ticket_price), budget: num(b.budget), history });
}
