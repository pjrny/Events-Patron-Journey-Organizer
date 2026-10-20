/**
 * "Will It Rain On My Event?" — GET /weather, GET /weather/r/:id, GET /api/weather/risk.
 * Deterministic, no AI. Data: Nominatim (geocode), Open-Meteo archive + forecast, Nager.Date,
 * optional Calendarific (CALENDARIFIC_KEY), optional festival directory table in D1.
 * Response shape: weather-risk.v1 (docs/WEATHER.md).
 */
import type { Env } from "./env";
import { HttpError, clientIp } from "./http";
import { sha256Hex, randomToken } from "./crypto";

const UA = "PatronJourney-WeatherRisk/1.0 (+https://www.pjrny.com; info@pjrny.com)";
const UNCACHED_PER_IP_PER_HOUR = 30;
const CACHE_HOURS = 24;
const YEARS = 5;
const WINDOW = 3;
const RAIN_MM = 2, GUST_CAUTION = 40, GUST_HOLD = 60, HOT_C = 32, COLD_C = 5;
const F_COUNTRIES = new Set(["US", "LR", "MM", "BS", "KY", "PW", "FM", "MH", "PR", "GU", "VI", "AS"]);
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const cToF = (c: number | null) => (c == null ? null : Math.round((c * 9) / 5 + 32));
const r1 = (x: number) => Math.round(x * 10) / 10;
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const normQ = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

async function getJson(url: string, timeoutMs = 9000): Promise<any> {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

// ---------- Geocoding (Nominatim, cached, <=1 req/s) ----------
type Geo = { lat: number; lon: number; display_name: string; city: string | null; state: string | null; country_code: string | null };

async function throttleNominatim(env: Env) {
  for (let i = 0; i < 4; i++) {
    const now = Date.now();
    // Claim the slot atomically: only succeeds if the last call was >=1100ms ago.
    const res = await env.DB.prepare(
      "INSERT INTO nominatim_throttle (id, last_ms) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET last_ms = ?1 WHERE nominatim_throttle.last_ms <= ?1 - 1100",
    ).bind(now).run();
    if ((res.meta?.changes ?? 0) > 0) return;
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new HttpError(503, "Address lookup is busy. Try again in a few seconds.", "geocode_busy");
}

async function geocode(env: Env, address: string): Promise<Geo> {
  const q = normQ(address);
  const hit = await env.DB.prepare("SELECT * FROM geocode_cache WHERE q = ?").bind(q).first<any>();
  if (hit) return { lat: hit.lat, lon: hit.lon, display_name: hit.display_name, city: hit.city, state: hit.state, country_code: hit.country_code };
  await throttleNominatim(env);
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(address)}&email=info@pjrny.com`;
  let arr: any[];
  try { arr = await getJson(u); } catch (e) { throw new HttpError(502, "Address lookup failed. Try again shortly.", "geocode_failed"); }
  if (!arr?.length) throw new HttpError(404, "We couldn't find that address. Try adding the city and state/country.", "address_not_found");
  const a = arr[0], ad = a.address ?? {};
  const g: Geo = {
    lat: Number(a.lat), lon: Number(a.lon), display_name: a.display_name,
    city: ad.city ?? ad.town ?? ad.village ?? ad.hamlet ?? ad.municipality ?? ad.county ?? null,
    state: ad.state ?? ad.region ?? null,
    country_code: ad.country_code ? String(ad.country_code).toUpperCase() : null,
  };
  await env.DB.prepare("INSERT OR REPLACE INTO geocode_cache (q, lat, lon, display_name, city, state, country_code) VALUES (?,?,?,?,?,?,?)")
    .bind(q, g.lat, g.lon, g.display_name, g.city, g.state, g.country_code).run();
  return g;
}

// ---------- Open-Meteo ----------
const DAILY = "precipitation_sum,weather_code,wind_gusts_10m_max,temperature_2m_max,temperature_2m_min";
function meteoUrl(env: Env, kind: "archive" | "forecast", lat: number, lon: number, start: string, end: string) {
  const paid = env.OPEN_METEO_PLAN === "commercial" && !!env.OPEN_METEO_API_KEY;
  const host = kind === "archive" ? (paid ? "customer-archive-api.open-meteo.com" : "archive-api.open-meteo.com") : (paid ? "customer-api.open-meteo.com" : "api.open-meteo.com");
  return `https://${host}/v1/${kind}?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&daily=${DAILY}&timezone=auto` + (paid ? `&apikey=${encodeURIComponent(String(env.OPEN_METEO_API_KEY))}` : "");
}
type Day = { date: string; precip_mm: number | null; code: number | null; gust_kmh: number | null; tmax_c: number | null; tmin_c: number | null };
function days(j: any): Day[] {
  const d = j?.daily; if (!d?.time) return [];
  return d.time.map((t: string, i: number) => ({ date: t, precip_mm: d.precipitation_sum?.[i] ?? null, code: d.weather_code?.[i] ?? null, gust_kmh: d.wind_gusts_10m_max?.[i] ?? null, tmax_c: d.temperature_2m_max?.[i] ?? null, tmin_c: d.temperature_2m_min?.[i] ?? null }));
}
function shiftYear(d: Date, years: number): Date {
  const y = d.getUTCFullYear() - years, m = d.getUTCMonth(); let day = d.getUTCDate();
  if (m === 1 && day === 29) day = 28;
  return new Date(Date.UTC(y, m, day));
}

// ---------- Holidays ----------
async function holidays(env: Env, cc: string | null, start: Date, n: number) {
  const out: { date: string; name: string; source: string }[] = [];
  const notes: string[] = [];
  if (!cc) return { list: out, notes: ["No country found for this address; holidays skipped."] };
  const from = ymd(addDays(start, -1)), to = ymd(addDays(start, n));
  const years = [...new Set([start.getUTCFullYear(), addDays(start, n).getUTCFullYear()])];
  for (const y of years) {
    try {
      const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/${cc}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(6000) });
      if (r.status === 200) for (const h of (await r.json()) as any[]) { if (h.date >= from && h.date <= to && (h.global !== false || !h.counties)) out.push({ date: h.date, name: h.name, source: "nager.date" }); }
      else notes.push(`Nager.Date has no public holiday data for ${cc}.`);
    } catch { notes.push("Nager.Date lookup failed."); }
  }
  if (env.CALENDARIFIC_KEY) {
    try {
      const months = [...new Set([start.getUTCMonth() + 1, addDays(start, n).getUTCMonth() + 1])];
      for (const m of months) {
        const j = await getJson(`https://calendarific.com/api/v2/holidays?api_key=${encodeURIComponent(String(env.CALENDARIFIC_KEY))}&country=${cc}&year=${start.getUTCFullYear()}&month=${m}`, 6000);
        for (const h of j?.response?.holidays ?? []) {
          const d = String(h?.date?.iso ?? "").slice(0, 10);
          if (d >= from && d <= to && !out.some((o) => o.date === d && o.name === h.name)) out.push({ date: d, name: h.name, source: "calendarific" });
        }
      }
    } catch { notes.push("Calendarific lookup failed; observances skipped."); }
  } else notes.push("Observances (Calendarific) not enabled; public holidays only.");
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { list: out, notes };
}

// ---------- Competition (optional festival directory) ----------
async function competition(env: Env, g: Geo, start: Date) {
  const tbl = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('festival_directory','festivals') LIMIT 1").first<{ name: string }>();
  if (!tbl) return { value: null, note: "Festival directory not loaded in D1 yet; competing events not checked." };
  try {
    const month = start.getUTCMonth() + 1;
    const rows = await env.DB.prepare(`SELECT name, city, month FROM ${tbl.name} WHERE lower(city) = lower(?) AND CAST(month AS INTEGER) = ? LIMIT 25`).bind(g.city ?? "", month).all<any>();
    const list = (rows.results ?? []).map((r: any) => ({ name: r.name, city: r.city, month: Number(r.month) }));
    return { value: { count: list.length, events: list, basis: "same city, same month" }, note: null };
  } catch { return { value: null, note: "Festival directory table has an unexpected shape; competing events not checked." }; }
}

// ---------- Core ----------
export async function weatherRisk(env: Env, req: Request, address: string, dateStr: string, nDays: number) {
  address = (address ?? "").trim();
  if (address.length < 3 || address.length > 200) throw new HttpError(400, "Enter the event address (city and state/country at least).", "invalid_address");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr ?? "")) throw new HttpError(400, "date must be YYYY-MM-DD", "invalid_date");
  const start = new Date(dateStr + "T00:00:00Z");
  if (isNaN(start.getTime())) throw new HttpError(400, "date is not a real date", "invalid_date");
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const daysOut = Math.round((start.getTime() - today.getTime()) / 86400000);
  if (daysOut < -366 || daysOut > 730) throw new HttpError(400, "Pick a date within the next 2 years.", "invalid_date");
  if (!Number.isInteger(nDays) || nDays < 1 || nDays > 5) throw new HttpError(400, "days must be 1 to 5", "invalid_days");

  const cacheKey = `${normQ(address)}|${dateStr}|${nDays}`;
  const cached = await env.DB.prepare(`SELECT id, payload FROM weather_results WHERE cache_key = ? AND created_at > datetime('now', '-${CACHE_HOURS} hours') ORDER BY created_at DESC LIMIT 1`).bind(cacheKey).first<{ id: string; payload: string }>();
  if (cached) return { ...JSON.parse(cached.payload), cached: true };

  const ipHash = await sha256Hex("weather-ip:" + (clientIp(req) ?? "unknown"));
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM weather_results WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')").bind(ipHash).first<{ n: number }>();
  if ((n?.n ?? 0) >= UNCACHED_PER_IP_PER_HOUR) throw new HttpError(429, "Too many weather checks from this network. Try again in an hour.", "rate_limited");

  const g = await geocode(env, address);
  const eventDates = Array.from({ length: nDays }, (_, i) => addDays(start, i));
  // Last 5 seasons whose +-3 day window is fully in the archive (archive lags ~5 days).
  const first = addDays(shiftYear(start, 1), nDays + WINDOW + 6) > today ? 2 : 1;
  const yearsBack = Array.from({ length: YEARS }, (_, i) => first + i);

  const notes: string[] = [];
  const pastYears = await Promise.all(yearsBack.map(async (k) => {
    const s = shiftYear(start, k);
    const ws = addDays(s, -WINDOW), we = addDays(s, nDays - 1 + WINDOW);
    try {
      const d = days(await getJson(meteoUrl(env, "archive", g.lat, g.lon, ymd(ws), ymd(we))));
      const evSet = new Set(Array.from({ length: nDays }, (_, i) => ymd(addDays(s, i))));
      return { year: s.getUTCFullYear(), window: d, event: d.filter((x) => evSet.has(x.date)) };
    } catch (e) { notes.push(`Historical data for ${s.getUTCFullYear()} unavailable.`); return null; }
  }));
  const years = pastYears.filter((y): y is NonNullable<typeof y> => !!y && y.event.length > 0);
  if (!years.length) throw new HttpError(502, "Historical weather is unavailable right now. Try again shortly.", "weather_unavailable");

  let forecast: Day[] | null = null;
  if (daysOut >= 0 && daysOut + nDays - 1 <= 15) {
    try { forecast = days(await getJson(meteoUrl(env, "forecast", g.lat, g.lon, ymd(start), ymd(addDays(start, nDays - 1))))); } catch { notes.push("Live forecast unavailable; using history only."); }
  }

  // Year-level hits (event days only) -> "X of last N years"
  const N = years.length;
  const any = (f: (d: Day) => boolean) => years.filter((y) => y.event.some(f)).length;
  const rainY = any((d) => (d.precip_mm ?? 0) > RAIN_MM);
  const stormY = any((d) => d.code != null && d.code >= 95 && d.code <= 99);
  const cautionY = any((d) => (d.gust_kmh ?? 0) > GUST_CAUTION);
  const holdY = any((d) => (d.gust_kmh ?? 0) > GUST_HOLD);
  const hotY = any((d) => (d.tmax_c ?? -99) > HOT_C);
  const coldY = any((d) => (d.tmin_c ?? 99) < COLD_C);
  // Window climatology (+-3 days, all years)
  const all = years.flatMap((y) => y.window);
  const avg = (f: (d: Day) => number | null) => { const v = all.map(f).filter((x): x is number => x != null); return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const maxOf = (f: (d: Day) => number | null) => { const v = all.map(f).filter((x): x is number => x != null); return v.length ? r1(Math.max(...v)) : null; };
  const wetDayPct = pct(all.filter((d) => (d.precip_mm ?? 0) > RAIN_MM).length, all.length);

  // Forecast overrides (if any) are blended: forecast flags push the share to at least 80/60%.
  const fc = forecast && forecast.length ? {
    rain: forecast.some((d) => (d.precip_mm ?? 0) > RAIN_MM), storm: forecast.some((d) => d.code != null && d.code >= 95),
    hold: forecast.some((d) => (d.gust_kmh ?? 0) > GUST_HOLD), caution: forecast.some((d) => (d.gust_kmh ?? 0) > GUST_CAUTION),
    hot: forecast.some((d) => (d.tmax_c ?? -99) > HOT_C), cold: forecast.some((d) => (d.tmin_c ?? 99) < COLD_C),
  } : null;
  const P = (hits: number, f?: boolean) => { const h = pct(hits, N); return fc ? (f ? Math.max(h, 80) : Math.round(h * 0.5)) : h; };
  const rainP = P(rainY, fc?.rain), stormP = P(stormY, fc?.storm), cautionP = P(cautionY, fc?.caution), holdP = P(holdY, fc?.hold), hotP = P(hotY, fc?.hot), coldP = P(coldY, fc?.cold);

  const hol = await holidays(env, g.country_code, start, nDays);
  notes.push(...hol.notes);
  const comp = await competition(env, g, start);
  if (comp.note) notes.push(comp.note);

  // Composite (weights renormalized when competition is unknown)
  const windScore = Math.min(100, holdP + 0.5 * Math.max(0, cautionP - holdP));
  const tempScore = Math.max(hotP, coldP);
  const holidayScore = hol.list.length ? 40 : 0;
  const compScore = comp.value ? Math.min(100, comp.value.count * 20) : null;
  const parts: [number, number][] = [[rainP, 0.35], [stormP, 0.2], [windScore, 0.15], [tempScore, 0.15], [holidayScore, 0.05]];
  if (compScore != null) parts.push([compScore, 0.1]);
  const wsum = parts.reduce((a, [, w]) => a + w, 0);
  const score = Math.round(parts.reduce((a, [s, w]) => a + s * w, 0) / wsum);
  const label = score < 20 ? "Low" : score < 40 ? "Moderate" : score < 60 ? "Elevated" : "High";

  const unit = g.country_code && F_COUNTRIES.has(g.country_code) ? "F" : "C";
  const avgHi = avg((d) => d.tmax_c), avgLo = avg((d) => d.tmin_c);
  const t = (c: number | null) => (c == null ? "?" : unit === "F" ? `${cToF(c)}°F` : `${Math.round(c)}°C`);
  const of = (h: number) => `${h} of last ${N} year${N === 1 ? "" : "s"}`;

  // Dates label "Oct 17-18"
  const end = eventDates[eventDates.length - 1];
  const dl = nDays === 1 ? `${MON[start.getUTCMonth()]} ${start.getUTCDate()}` : start.getUTCMonth() === end.getUTCMonth() ? `${MON[start.getUTCMonth()]} ${start.getUTCDate()}-${end.getUTCDate()}` : `${MON[start.getUTCMonth()]} ${start.getUTCDate()}-${MON[end.getUTCMonth()]} ${end.getUTCDate()}`;
  const place = g.city ?? g.display_name.split(",")[0];
  const headline = `${place}, ${dl}: ${rainP}% chance of rain`;

  // Feed lines (simulator)
  const feed: string[] = [];
  const dayNames = eventDates.map((d) => DOW[d.getUTCDay()]);
  if (fc && forecast) {
    forecast.forEach((d, i) => {
      if (d.code != null && d.code >= 95) feed.push(`Forecast: storms likely ${dayNames[i]}`);
      else if ((d.precip_mm ?? 0) > RAIN_MM) feed.push(`Forecast: rain ${dayNames[i]} (~${r1(d.precip_mm!)} mm)`);
      if ((d.gust_kmh ?? 0) > GUST_HOLD) feed.push(`Forecast: gusts to ${Math.round(d.gust_kmh!)} km/h ${dayNames[i]}, plan a stage hold`);
      if ((d.tmax_c ?? 0) > HOT_C) feed.push(`Forecast: ${t(d.tmax_c)} ${dayNames[i]}, heat plan on`);
    });
  }
  // Per-day historical storms (e.g. "Storms hit a Saturday-equivalent day in 2 of last 5 years")
  dayNames.forEach((name, i) => {
    const s = years.filter((y) => { const d = y.event[i]; return d && d.code != null && d.code >= 95; }).length;
    if (s >= 2) feed.push(`Storms likely ${name}: thunderstorms on this date in ${of(s)}`);
  });
  if (rainP >= 50) feed.push(`Rain on event days in ${of(rainY)}: walk-up sales take the hit`);
  if (holdY) feed.push(`Gusts over ${GUST_HOLD} km/h in ${of(holdY)}: stage hold risk`);
  if (hotY) feed.push(`Over ${unit === "F" ? "90°F" : "32°C"} in ${of(hotY)}: bar sales up, medical load up`);
  if (coldY) feed.push(`Below ${unit === "F" ? "41°F" : "5°C"} at night in ${of(coldY)}: bring warming tents`);
  if (score < 20 && !hotY && !coldY) feed.push(`Typically ${t(avgHi)} and dry: sunny and ${t(avgHi)}, perfect`);
  if (hol.list.length) feed.push(`${hol.list[0].name} on ${hol.list[0].date}: attendance boost, staffing costs up`);

  // Backup plan (rules)
  const plan: string[] = [];
  if (rainP > 50) plan.push("Rain is likely: book tents for stages, bars and box office, lay ground cover/trackway on main paths, and have a rain-date or refund policy ready.");
  else if (rainP > 0) plan.push("Some rain risk: reserve tents and ground cover on a cancel-free hold.");
  if (stormP > 0) plan.push("Lightning policy: name a weather lead, set a 30-minute shelter-in-place rule after each strike within 10 miles (16 km), and pre-script PA/SMS announcements.");
  if (cautionP > 0) plan.push(`Wind-rated staging and a written gust policy: secure banners and tents at ${GUST_CAUTION} km/h (25 mph), hold shows and lower scrims at ${GUST_HOLD} km/h (37 mph).`);
  if (hotP > 0) plan.push("Heat: free water refill stations, shade structures, misting, extra medical staff and a cooling tent; schedule headliners after sunset.");
  if (coldP > 0) plan.push("Cold: warming tents, hot drinks at every bar, and remind ticket holders to dress in layers.");
  if (!plan.length) plan.push("Historically calm: keep a basic weather watch and a tent on standby.");

  // Simulator modifiers (fractions 0..1 of probability)
  const pr = rainP / 100, ps = stormP / 100, ph = hotP / 100, pc = coldP / 100, pw = holdP / 100;
  const simulator = {
    attendance: {
      walk_up_multiplier: r2(1 - 0.25 * pr - 0.1 * ps - 0.05 * pc),
      pay_at_door_multiplier: r2(1 - 0.35 * pr - 0.15 * ps - 0.05 * pc),
      presale_no_show_add: r2(0.03 * pr + 0.04 * ps + 0.02 * Math.max(ph, pc)),
      holiday_multiplier: hol.list.length ? 1.05 : 1,
    },
    bar_spend_multiplier: r2(1 + 0.12 * ph - 0.1 * pc - 0.05 * pr),
    contingency: [
      { flag: "tents_ground_cover", on: rainP > 50, probability: rainP, suggested_cost_pct_of_budget: rainP > 50 ? 3 : 0 },
      { flag: "lightning_policy", on: stormP > 0, probability: stormP, suggested_cost_pct_of_budget: 0 },
      { flag: "wind_rated_staging", on: cautionP > 0, probability: cautionP, suggested_cost_pct_of_budget: holdP > 0 ? 2 : cautionP > 0 ? 1 : 0 },
      { flag: "heat_water_medical_shade", on: hotP > 0, probability: hotP, suggested_cost_pct_of_budget: hotP > 0 ? 2 : 0 },
      { flag: "warming_tents", on: coldP > 0, probability: coldP, suggested_cost_pct_of_budget: coldP > 0 ? 1.5 : 0 },
    ],
    variance_widen: r2(1 + 0.3 * pr + 0.3 * ps + 0.2 * pw),
    feed,
  };

  const id = "wx_" + randomToken(9);
  const result = {
    schema: "weather-risk.v1",
    ok: true,
    id,
    permalink: `/weather/r/${id}`,
    generated_at: new Date().toISOString(),
    cached: false,
    input: { address, date: dateStr, days: nDays },
    location: { ...g, lat: r4(g.lat), lon: r4(g.lon) },
    dates: { start: dateStr, end: ymd(end), label: dl, weekdays: dayNames, days_out: daysOut },
    headline,
    units: { default: unit },
    risk: { score, label },
    history: {
      years_checked: N, years: years.map((y) => y.year), window_days: WINDOW,
      rain: { pct: rainP, years_hit: rainY, phrase: `Rain (>${RAIN_MM} mm) on event days in ${of(rainY)}`, wet_day_pct_window: wetDayPct, avg_precip_mm: avg((d) => d.precip_mm) },
      storms: { pct: stormP, years_hit: stormY, phrase: `Thunderstorms in ${of(stormY)}` },
      wind: { caution_pct: cautionP, hold_pct: holdP, caution_years: cautionY, hold_years: holdY, max_gust_kmh: maxOf((d) => d.gust_kmh), phrase: `Gusts over ${GUST_CAUTION} km/h in ${of(cautionY)}, over ${GUST_HOLD} km/h in ${of(holdY)}` },
      heat: { pct: hotP, years_hit: hotY, phrase: `Highs over 32°C / 90°F in ${of(hotY)}` },
      cold: { pct: coldP, years_hit: coldY, phrase: `Lows under 5°C / 41°F in ${of(coldY)}` },
      temps: { avg_high_c: avgHi, avg_low_c: avgLo, avg_high_f: cToF(avgHi), avg_low_f: cToF(avgLo), max_high_c: maxOf((d) => d.tmax_c), min_low_c: (() => { const v = all.map((d) => d.tmin_c).filter((x): x is number => x != null); return v.length ? r1(Math.min(...v)) : null; })() },
      by_year: years.map((y) => ({ year: y.year, event_days: y.event })),
    },
    forecast: forecast ? { days: forecast } : null,
    holidays: hol.list,
    competition: comp.value,
    backup_plan: plan,
    simulator,
    links: { plan_free: "/dashboard", paid: env.PAID_UPGRADE_URL || "https://www.pjrny.com/#Contact-us" },
    notes: [...notes, "Based on a small 5-year sample, not a forecast" + (forecast ? " (live forecast blended in)." : "."), env.OPEN_METEO_PLAN === "commercial" ? "Weather data: Open-Meteo (commercial plan)." : "Weather data: Open-Meteo (free, non-commercial tier)."],
    sources: ["Open-Meteo", "OpenStreetMap Nominatim", "Nager.Date", ...(env.CALENDARIFIC_KEY ? ["Calendarific"] : [])],
  };
  await env.DB.prepare("INSERT INTO weather_results (id, cache_key, payload, ip_hash) VALUES (?,?,?,?)").bind(id, cacheKey, JSON.stringify(result), ipHash).run();
  return result;
}
function r2(x: number) { return Math.round(x * 100) / 100; }
function r4(x: number) { return Math.round(x * 10000) / 10000; }

export async function getWeatherResult(env: Env, id: string): Promise<any | null> {
  if (!/^wx_[A-Za-z0-9_-]{6,40}$/.test(id)) return null;
  const r = await env.DB.prepare("SELECT payload FROM weather_results WHERE id = ?").bind(id).first<{ payload: string }>();
  return r ? JSON.parse(r.payload) : null;
}
