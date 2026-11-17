/**
 * Date effects on draw — date-effects.v1 (docs/DATE_EFFECTS.md). Deterministic, no AI.
 * day-of-week multiplier x public-holiday adjustment (Nager.Date) x curated "going-out" / "stay-in" days,
 * then a competition penalty for busy nights (more competing events). These are Patron Journey planning
 * assumptions, NOT fitted to ticket data: your own history (/talent "historic data") always outranks them.
 */
import type { Env } from "./env";
import { HttpError } from "./http";

const UA = "PatronJourney-DateEffects/1.0 (+https://www.pjrny.com; info@pjrny.com)";
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Saturday = 1.00 reference. Fri/Sat high, Sun medium, Mon–Thu lower. */
export const WEEKDAY: Record<number, { label: string; mult: number }> = {
  0: { label: "Sunday", mult: 0.85 }, 1: { label: "Monday", mult: 0.7 }, 2: { label: "Tuesday", mult: 0.65 }, 3: { label: "Wednesday", mult: 0.7 },
  4: { label: "Thursday", mult: 0.8 }, 5: { label: "Friday", mult: 0.95 }, 6: { label: "Saturday", mult: 1.0 },
};
export const HOLIDAY_RULES = {
  weekday_public_holiday_floor: 0.9, // day off work: a Mon–Thu public holiday behaves close to a Sunday/Friday
  holiday_eve_floor: 0.95,           // night before a public holiday behaves like a Friday
  long_weekend_sunday_floor: 1.0,    // Sunday before a Monday holiday behaves like a Saturday
  public_holiday_competition: 0.05,  // more competing events on/around public holidays
};

type Special = { key: string; label: string; boost: number; competition: number; why: string; countries?: string[]; kind: "going_out" | "stay_in" | "info" };
const US = ["US"], ANGLO = ["US", "CA", "GB", "IE", "AU", "NZ"];

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
/** n-th (1-based) weekday `wd` of month m (1-12); n = -1 = last. */
function nthWeekday(y: number, m: number, wd: number, n: number): string {
  if (n > 0) { const first = new Date(Date.UTC(y, m - 1, 1)); const off = (wd - first.getUTCDay() + 7) % 7; return ymd(new Date(Date.UTC(y, m - 1, 1 + off + 7 * (n - 1)))); }
  const last = new Date(Date.UTC(y, m, 0)); const off = (last.getUTCDay() - wd + 7) % 7; return ymd(new Date(Date.UTC(y, m - 1, last.getUTCDate() - off)));
}
function easter(y: number): string { // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
}

/** Curated calendar for year y: date -> special days. */
export function specialDays(y: number): Record<string, Special[]> {
  const out: Record<string, Special[]> = {};
  const add = (d: string, s: Special) => (out[d] ??= []).push(s);
  const thanks = nthWeekday(y, 11, 4, 4);
  const p = (m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  add(p(12, 31), { key: "nye", label: "New Year's Eve", boost: 1.25, competition: 0.15, kind: "going_out", why: "Biggest going-out night of the year, but almost every venue and club runs an event." });
  add(p(10, 31), { key: "halloween", label: "Halloween", boost: 1.15, competition: 0.1, kind: "going_out", countries: ANGLO, why: "Costume-party night: people plan to go out, and bars, clubs and promoters all compete for them." });
  for (let d = 25; d <= 30; d++) {
    const wd = new Date(Date.UTC(y, 9, d)).getUTCDay();
    if (wd === 5 || wd === 6) add(p(10, d), { key: "halloween_weekend", label: "Halloween weekend", boost: 1.05, competition: 0.08, kind: "going_out", countries: ANGLO, why: "Most Halloween parties land on the weekend before Oct 31, so this Fri/Sat is busier and more crowded with events." });
  }
  add(ymd(addDays(new Date(thanks + "T00:00:00Z"), -1)), { key: "blackout_wednesday", label: "Day before Thanksgiving (\"Blackout Wednesday\")", boost: 1.15, competition: 0.08, kind: "going_out", countries: US, why: "People are home for the holiday with Thursday off; one of the busiest bar nights in the US." });
  add(thanks, { key: "thanksgiving", label: "Thanksgiving Day", boost: 0.6, competition: 0, kind: "stay_in", countries: US, why: "Family dinner day; most people stay in." });
  add(p(3, 17), { key: "st_patricks", label: "St. Patrick's Day", boost: 1.1, competition: 0.08, kind: "going_out", countries: ANGLO, why: "Going-out day, with pub crawls and parades competing for the same crowd." });
  add(p(5, 5), { key: "cinco_de_mayo", label: "Cinco de Mayo", boost: 1.05, competition: 0.05, kind: "going_out", countries: US, why: "Popular going-out day in the US, with many bar and restaurant events." });
  add(p(7, 3), { key: "july4_eve", label: "Eve of Independence Day", boost: 1.1, competition: 0.08, kind: "going_out", countries: US, why: "July 4 eve is a big night out, and many cities hold fireworks shows that weekend." });
  add(p(7, 4), { key: "july4", label: "Independence Day", boost: 1.05, competition: 0.12, kind: "going_out", countries: US, why: "Lots of people out, but free city fireworks and cookouts compete hard for them." });
  add(ymd(addDays(new Date(nthWeekday(y, 5, 1, -1) + "T00:00:00Z"), -1)), { key: "memorial_sunday", label: "Memorial Day weekend Sunday", boost: 1.05, competition: 0.06, kind: "going_out", countries: US, why: "Monday is off, so Sunday night behaves like a Saturday; festival season kickoff weekend." });
  add(ymd(addDays(new Date(nthWeekday(y, 9, 1, 1) + "T00:00:00Z"), -1)), { key: "labor_sunday", label: "Labor Day weekend Sunday", boost: 1.05, competition: 0.06, kind: "going_out", countries: US, why: "Monday is off, so Sunday night behaves like a Saturday; end-of-summer event weekend." });
  add(p(12, 24), { key: "christmas_eve", label: "Christmas Eve", boost: 0.7, competition: 0, kind: "stay_in", why: "Family evening for most people." });
  add(p(12, 25), { key: "christmas", label: "Christmas Day", boost: 0.5, competition: 0, kind: "stay_in", why: "Most people stay home." });
  add(easter(y), { key: "easter", label: "Easter Sunday", boost: 0.85, competition: 0, kind: "stay_in", why: "Family day for many; lower going-out demand." });
  add(nthWeekday(y, 2, 0, 2), { key: "super_bowl", label: "Super Bowl Sunday (usually)", boost: 0.85, competition: 0.05, kind: "stay_in", countries: US, why: "Most people watch the game at home or at watch parties. The NFL sets the date, so check it." });
  for (let m = 1; m <= 12; m++) if (new Date(Date.UTC(y, m - 1, 13)).getUTCDay() === 5)
    add(p(m, 13), { key: "friday_13", label: "Friday the 13th", boost: 1.0, competition: 0, kind: "info", why: "Shown for themed promos only. There is no reliable evidence it changes turnout, so no effect is applied." });
  return out;
}

async function publicHolidays(env: Env, cc: string, year: number): Promise<{ list: { date: string; name: string }[]; note?: string }> {
  const k = `nager|${cc}|${year}`;
  try {
    const hit = await env.DB.prepare("SELECT payload FROM talent_source_cache WHERE k = ? AND created_at > datetime('now', '-30 days')").bind(k).first<{ payload: string }>();
    if (hit) return { list: JSON.parse(hit.payload) };
  } catch { /* cache table missing: fall through */ }
  try {
    const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${cc}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(6000) });
    if (r.status !== 200) return { list: [], note: `Nager.Date has no public holiday data for ${cc}.` };
    const list = ((await r.json()) as any[]).filter((h) => h.global !== false || !h.counties).map((h) => ({ date: String(h.date), name: String(h.name) }));
    await env.DB.prepare("INSERT OR REPLACE INTO talent_source_cache (k, payload, created_at) VALUES (?,?,CURRENT_TIMESTAMP)").bind(k, JSON.stringify(list)).run().catch(() => {});
    return { list };
  } catch { return { list: [], note: "Nager.Date lookup failed; public holidays skipped." }; }
}

export type DaySignal = { kind: "weekday" | "public_holiday" | "holiday_eve" | "long_weekend" | "going_out" | "stay_in" | "info"; label: string; effect: string; why: string };
export type DayEffect = { date: string; weekday: string; day_multiplier: number; demand_boost: number; competition_penalty: number; net_multiplier: number; signals: DaySignal[] };

function dayEffect(date: string, cc: string, hol: Map<string, string>): DayEffect {
  const d = new Date(date + "T00:00:00Z"), wd = d.getUTCDay();
  const signals: DaySignal[] = [];
  let mult = WEEKDAY[wd].mult;
  signals.push({ kind: "weekday", label: WEEKDAY[wd].label, effect: `×${WEEKDAY[wd].mult}`, why: wd === 6 ? "Saturday is the reference night (×1.00)." : wd === 5 ? "Friday is nearly as strong as Saturday." : wd === 0 ? "Sunday is medium: many people work Monday." : "Weeknights draw less: most people work the next day." });
  let competition = 0;
  const today = hol.get(date), tomorrow = hol.get(ymd(addDays(d, 1)));
  if (today) {
    competition = Math.max(competition, HOLIDAY_RULES.public_holiday_competition);
    if (wd >= 1 && wd <= 4 && mult < HOLIDAY_RULES.weekday_public_holiday_floor) { mult = HOLIDAY_RULES.weekday_public_holiday_floor; signals.push({ kind: "public_holiday", label: `Public holiday: ${today}`, effect: `day ×${mult}, competition −${HOLIDAY_RULES.public_holiday_competition * 100}%`, why: "Most people are off work, so a weeknight holiday draws close to a weekend night. More events compete for them, though." }); }
    else signals.push({ kind: "public_holiday", label: `Public holiday: ${today}`, effect: `competition −${HOLIDAY_RULES.public_holiday_competition * 100}%`, why: "Already a strong night. Holidays bring more competing events." });
  }
  if (tomorrow) {
    if (wd === 0 && mult < HOLIDAY_RULES.long_weekend_sunday_floor) { mult = HOLIDAY_RULES.long_weekend_sunday_floor; signals.push({ kind: "long_weekend", label: `Long-weekend Sunday (before ${tomorrow})`, effect: `day ×${mult}`, why: "Monday is a holiday, so Sunday night behaves like a Saturday." }); }
    else if (wd >= 1 && wd <= 4 && mult < HOLIDAY_RULES.holiday_eve_floor) { mult = HOLIDAY_RULES.holiday_eve_floor; signals.push({ kind: "holiday_eve", label: `Eve of ${tomorrow}`, effect: `day ×${mult}`, why: "Tomorrow is a day off, so tonight behaves like a Friday." }); }
  }
  let boost = 1;
  for (const s of specialDays(d.getUTCFullYear())[date] ?? []) {
    if (s.countries && !s.countries.includes(cc)) continue;
    boost *= s.boost; competition = Math.max(competition, s.competition);
    signals.push({ kind: s.kind, label: s.label, effect: s.kind === "info" ? "no effect" : `demand ×${s.boost}${s.competition ? `, competition −${Math.round(s.competition * 100)}%` : ""}`, why: s.why });
  }
  const net = clamp(mult * boost * (1 - competition), 0.3, 1.4);
  return { date, weekday: WEEKDAY[wd].label, day_multiplier: r3(mult), demand_boost: r3(boost), competition_penalty: r3(competition), net_multiplier: r3(net), signals };
}

export async function dateEffects(env: Env, start: string, end: string | null, countryCode: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || isNaN(Date.parse(start))) throw new HttpError(400, "date must be YYYY-MM-DD", "invalid_date");
  let e = end && /^\d{4}-\d{2}-\d{2}$/.test(end) && !isNaN(Date.parse(end)) && end >= start ? end : start;
  const s0 = new Date(start + "T00:00:00Z");
  if ((Date.parse(e) - s0.getTime()) / 86400000 > 6) e = ymd(addDays(s0, 6));
  const cc = (countryCode || "US").toUpperCase().slice(0, 2);
  const days: string[] = []; for (let d = s0; ymd(d) <= e; d = addDays(d, 1)) days.push(ymd(d));
  const years = [...new Set([...days, ymd(addDays(new Date(e + "T00:00:00Z"), 1))].map((x) => Number(x.slice(0, 4))))];
  const hol = new Map<string, string>(); const notes: string[] = [];
  for (const y of years) { const h = await publicHolidays(env, cc, y); h.list.forEach((x) => hol.set(x.date, hol.has(x.date) ? hol.get(x.date)! : x.name)); if (h.note) notes.push(h.note); }
  const per = days.map((d) => dayEffect(d, cc, hol));
  const mean = (f: (x: DayEffect) => number) => r3(per.reduce((a, x) => a + f(x), 0) / per.length);
  const net = mean((x) => x.net_multiplier);
  const pct = Math.round((net - 1) * 100);
  return {
    schema: "date-effects.v1", start, end: e, country: cc, days: per,
    net_multiplier: net, day_multiplier: mean((x) => x.day_multiplier), demand_boost: mean((x) => x.demand_boost), competition_penalty: mean((x) => x.competition_penalty),
    summary: `${per.length > 1 ? `${per.length}-day average` : per[0].weekday}: draw ×${net} vs a plain Saturday (${pct >= 0 ? "+" : ""}${pct}%).`,
    method: "net = day-of-week multiplier (Sat 1.00 … Tue 0.65; public-holiday/eve floors) × going-out/stay-in demand boost × (1 − competition penalty), averaged across festival days (max 7).",
    assumption: "Planning assumptions, not fitted to ticket sales. Your own historic sales outrank them.",
    sources: ["Nager.Date (public holidays)", "Patron Journey curated going-out calendar"],
    notes,
  };
}

export async function dateEffectsApi(env: Env, url: URL) {
  const q = url.searchParams;
  return dateEffects(env, q.get("date") ?? q.get("start") ?? "", q.get("end"), q.get("country"));
}
