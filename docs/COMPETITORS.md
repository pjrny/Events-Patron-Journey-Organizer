# Competitor Radar & festival directory

## Data: D1 `festival_directory` (migration 0005)
- 26,780 rows from `pjrny/forecast_sim_event` → `festivals.json` (main). Seed builder: `scripts/festival_dir/build_sql.py festivals.json cities1000.txt out.sql`, then `wrangler d1 execute events-patronjourney-db --remote --file out.sql`.
- Coordinates: offline GeoNames `cities1000` (CC-BY 4.0) city centroids. `geo_precision`: `city` (city+state+country match) or `city_country` (non-US city+country match); 2,339 rows have none (US cross-state fallback disabled).
- `website` = organization email domain (freemail excluded). **No emails/phones stored.** `socials` reserved (NULL). No lineups yet.
- Dates are the last listed edition (mostly 2018) and are projected onto the target year by month/day.

## GET /api/festivals
`city, state, country (ISO2), month (1-12), lat, lon, radius_km (default 100, max 500), q (name contains), type, page, per_page (≤100)`.
City OR radius are unioned; results sorted by distance. Rate limit: 60/min/IP (D1 `api_rate`).

## GET /api/competitors (schema `competitor-threat.v1`)
Params: `city` ("Austin, TX") or `lat`+`lon`; `country`; `date` (YYYY-MM-DD) or `month`; `days` (1-5, default 2); `genre`; `lineup` (newline/comma list); `limit`.
Selection: within 100 km AND (projected dates within ±14 days of the event, or same month when no date).

Per event `threat` = round(100 × proximity × date_overlap × genre × size × lineup), capped 100. Each factor has `{value, why}`:
| factor | values |
|---|---|
| proximity | 1 − 0.8·d/100, floor 0.2; 0.9 if same city w/o coords |
| date_overlap | overlap 1.0, ≤3 d 0.8, ≤7 d 0.6, ≤14 d 0.35, else 0.1; month-only 0.5 |
| genre | same genre 1.0, same type 0.7, music/unknown genre 0.6, different 0.25, none given 0.5 |
| size | clamp(log10(attendance)/5, 0.3, 1); unknown 0.5 |
| lineup | 1 + 0.25 × shared artists (max 2.0); 1.0 when no lineup data (current) |

Top level: `count, total_threat, competition_score = round(100·(1−e^(−total/300))), events[], open_weekends[5], weekends[13], input, notes`.
`weekends`: each Saturday in ±6 weeks, `total_threat` = sum of threats of events ≤7 days from that weekend; `open_weekends` = lowest 5.

## /api/weather/risk
`competition` = same `analyzeCompetition()` (no genre), events trimmed to name/city/type/genre/attendance/dates/distance/threat. `competition_score` feeds the 0.10 weight in the risk composite.

## Simulator use
Use `competition_score` as an attendance headwind (suggested: walk-up × (1 − 0.15·score/100)) and `open_weekends` for date suggestions. The JSON keys above are stable; additions only.
