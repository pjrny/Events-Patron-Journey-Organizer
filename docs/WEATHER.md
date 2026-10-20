# Will It Rain On My Event? (`/weather`)

Free, deterministic (no AI) weather-risk check for organizers, embeddable on pjrny.com like `/dashboard`
(same CSP `frame-ancestors` allow-list).

| Route | What |
|---|---|
| `GET /weather` | Page: address + start date + days (1-5) |
| `GET /weather/r/:id` | Shareable permalink with OG/Twitter meta (`"Austin, Oct 17-18: 20% chance of rain"`) |
| `GET /api/weather/risk?address=&date=YYYY-MM-DD&days=1..5` | JSON, schema `weather-risk.v1` |

## Data sources
- **Nominatim** geocoding, `User-Agent: PatronJourney-WeatherRisk/1.0 (+https://www.pjrny.com; info@pjrny.com)`.
  Cached forever in D1 `geocode_cache`; a single-row D1 slot (`nominatim_throttle`) keeps the Worker at ≤1 req/s.
- **Open-Meteo archive**: for each of the last 5 years whose window is already archived, the same calendar dates ±3 days:
  `precipitation_sum, weather_code, wind_gusts_10m_max, temperature_2m_max/min`.
  **Open-Meteo forecast** is blended in when the whole event is within 16 days.
- **Nager.Date** public holidays (event days ±1). **Calendarific** only if secret `CALENDARIFIC_KEY` is set.
- **Competition**: uses D1 table `festival_directory` (or `festivals`) with `name, city, month` if present; otherwise `competition: null` plus a note.

### Licensing / config
Open-Meteo's free API is **non-commercial**. When a paid plan is bought: set var `OPEN_METEO_PLAN` to `"commercial"`
in `wrangler.jsonc` and `wrangler secret put OPEN_METEO_API_KEY`; the Worker switches to `customer-*` endpoints.

## Caching & limits
Full responses are stored in D1 `weather_results` (migration `0004_weather.sql`). Same address/date/days within 24h returns the
stored result (`cached: true`, same permalink). Uncached checks: 30 per IP-hash per hour (429 `rate_limited`), same pattern as `/api/drafts`.
Permalinks do not expire.

## Scoring (deterministic)
"Event days" = the exact dates in each past year; "window" = ±3 days (climatology only).
All shares are **years hit / years checked** (shown as "4 of last 5 years"), not false precision.

| Factor | Rule |
|---|---|
| rain % | years with any event day `precipitation_sum > 2 mm` |
| storm % | years with any event day WMO code 95-99 |
| wind | caution: gust > 40 km/h; hold: gust > 60 km/h. score = hold% + ½·(caution% − hold%) |
| heat / cold | any event day high > 32 °C / low < 5 °C; temp score = max(heat%, cold%) |
| holiday | 40 if a public holiday falls on event days ±1 |
| competition | 20 per similar event, cap 100 (only when directory exists) |

Composite = 0.35·rain + 0.20·storm + 0.15·wind + 0.15·temp + 0.05·holiday (+ 0.10·competition), renormalized over present factors.
Labels: <20 Low, <40 Moderate, <60 Elevated, ≥60 High. With a live forecast, a forecast-flagged hazard is raised to ≥80%,
an unflagged one is halved.

Units: °F default for US (and other °F countries), °C elsewhere; both are always available (`*_c`, `*_f`, toggle on page).

## `weather-risk.v1` shape
```jsonc
{
  "schema": "weather-risk.v1", "ok": true, "id": "wx_…", "permalink": "/weather/r/wx_…",
  "generated_at": "ISO", "cached": false,
  "input": { "address": "…", "date": "2026-10-17", "days": 2 },
  "location": { "lat": 30.27, "lon": -97.77, "display_name": "…", "city": "Austin", "state": "Texas", "country_code": "US" },
  "dates": { "start": "…", "end": "…", "label": "Oct 17-18", "weekdays": ["Saturday","Sunday"], "days_out": -3 },
  "headline": "Austin, Oct 17-18: 20% chance of rain",
  "units": { "default": "F" },
  "risk": { "score": 14, "label": "Low" },
  "history": {
    "years_checked": 5, "years": [2025,2024,2023,2022,2021], "window_days": 3,
    "rain":   { "pct": 20, "years_hit": 1, "phrase": "…", "wet_day_pct_window": 9, "avg_precip_mm": 1.2 },
    "storms": { "pct": 0, "years_hit": 0, "phrase": "…" },
    "wind":   { "caution_pct": 40, "hold_pct": 0, "caution_years": 2, "hold_years": 0, "max_gust_kmh": 52.1, "phrase": "…" },
    "heat":   { "pct": 20, "years_hit": 1, "phrase": "…" },
    "cold":   { "pct": 0, "years_hit": 0, "phrase": "…" },
    "temps":  { "avg_high_c": 27.9, "avg_low_c": 15.8, "avg_high_f": 82, "avg_low_f": 60, "max_high_c": 35.6, "min_low_c": 6.6 },
    "by_year": [{ "year": 2025, "event_days": [{ "date": "…", "precip_mm": 0, "code": 1, "gust_kmh": 30, "tmax_c": 29, "tmin_c": 16 }] }]
  },
  "forecast": null | { "days": [ /* same Day shape */ ] },
  "holidays": [{ "date": "…", "name": "…", "source": "nager.date" | "calendarific" }],
  "competition": null | { "count": 2, "events": [{ "name": "…", "city": "…", "month": 10 }], "basis": "same city, same month" },
  "backup_plan": ["…rule-based lines…"],
  "simulator": {
    "attendance": {
      "walk_up_multiplier": 0.95,        // 1 − 0.25·rain − 0.10·storm − 0.05·cold
      "pay_at_door_multiplier": 0.93,    // 1 − 0.35·rain − 0.15·storm − 0.05·cold
      "presale_no_show_add": 0.01,       // +0.03·rain + 0.04·storm + 0.02·max(heat,cold)  (absolute rate)
      "holiday_multiplier": 1            // 1.05 when a holiday is adjacent
    },
    "bar_spend_multiplier": 1.01,        // 1 + 0.12·heat − 0.10·cold − 0.05·rain
    "contingency": [{ "flag": "tents_ground_cover" | "lightning_policy" | "wind_rated_staging" | "heat_water_medical_shade" | "warming_tents",
                      "on": true, "probability": 40, "suggested_cost_pct_of_budget": 1 }],
    "variance_widen": 1.06,              // multiply Monte Carlo band width: 1 + 0.3·rain + 0.3·storm + 0.2·wind_hold
    "feed": ["Storms likely Saturday: thunderstorms on this date in 2 of last 5 years", "Typically 75°F and dry: sunny and 75°F, perfect"]
  },
  "links": { "plan_free": "/dashboard", "paid": "https://www.pjrny.com/#Contact-us" },
  "notes": ["…"], "sources": ["Open-Meteo", "OpenStreetMap Nominatim", "Nager.Date"]
}
```
All probabilities in `simulator` formulas are fractions (pct/100). Fields are additive-only within v1.
