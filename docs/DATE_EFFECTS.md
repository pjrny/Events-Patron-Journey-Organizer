# Date effects on draw — `date-effects.v1`

`GET /api/date-effects?date=YYYY-MM-DD[&end=YYYY-MM-DD][&country=US]` (public, CORS for pjrny.com). Used by
`/talent` (multiplies the lineup total) and the Festival Simulator (`/forecaster/`, lineup panel + "Apply to Attendance N").
Source: `src/date_effects.ts`. Deterministic, no AI.

**These are planning assumptions, not fitted to ticket sales.** Your own historic sales (docs/HISTORY.md) outrank them.

## Formula (per day; multi-day events average up to 7 days)

```
net = day_multiplier × demand_boost × (1 − competition_penalty)      clamped 0.3 … 1.4
```

### 1. Day of week (Saturday = 1.00 reference)

| Sun | Mon | Tue | Wed | Thu | Fri | Sat |
|-----|-----|-----|-----|-----|-----|-----|
| 0.85 | 0.70 | 0.65 | 0.70 | 0.80 | 0.95 | 1.00 |

### 2. Public holidays (Nager.Date, cached 30 days in D1 `talent_source_cache`)

| Rule | Effect |
|---|---|
| Public holiday on Mon–Thu | day multiplier raised to ≥ 0.90 (day off work) |
| Eve of a public holiday, Mon–Thu | raised to ≥ 0.95 (behaves like a Friday) |
| Sunday before a Monday holiday | raised to ≥ 1.00 (long-weekend Sunday) |
| Any public holiday | competition penalty ≥ 5% |

### 3. Curated going-out / stay-in days

| Day | Countries | Demand | Competition | Why |
|---|---|---|---|---|
| New Year's Eve (Dec 31) | all | ×1.25 | −15% | biggest night out; every venue runs an event |
| Halloween (Oct 31) | US CA GB IE AU NZ | ×1.15 | −10% | costume parties; bars/clubs all compete |
| Halloween weekend (Fri/Sat Oct 25–30) | US CA GB IE AU NZ | ×1.05 | −8% | most parties land the weekend before |
| Day before Thanksgiving ("Blackout Wednesday") | US | ×1.15 | −8% | home for the holiday, Thursday off |
| Thanksgiving Day | US | ×0.60 | — | family dinner, stay-in |
| St. Patrick's Day (Mar 17) | US CA GB IE AU NZ | ×1.10 | −8% | pub crawls/parades compete |
| Cinco de Mayo (May 5) | US | ×1.05 | −5% | bar/restaurant events |
| July 3 (Independence Day eve) | US | ×1.10 | −8% | big night out, fireworks weekend |
| July 4 | US | ×1.05 | −12% | free city fireworks + cookouts compete |
| Memorial Day weekend Sunday | US | ×1.05 | −6% | Monday off; season kickoff |
| Labor Day weekend Sunday | US | ×1.05 | −6% | Monday off; end-of-summer |
| Christmas Eve / Christmas Day | all | ×0.70 / ×0.50 | — | family days |
| Easter Sunday | all | ×0.85 | — | family day |
| Super Bowl Sunday (2nd Sun of Feb, verify) | US | ×0.85 | −5% | watch parties |
| Friday the 13th | all | no effect | — | shown for themed promos only; no reliable evidence |

The simulator derives the country from its Timezone field (America/Toronto → CA, Europe/London → GB, …; default US).
`/talent` uses the geocoded country of the city.

## Response

`{ schema, start, end, country, days: [{ date, weekday, day_multiplier, demand_boost, competition_penalty, net_multiplier, signals: [{kind,label,effect,why}] }], net_multiplier, summary, method, assumption, sources, notes }`

## Interaction with other models

- `/talent` (talent-draw.v2): `lineup_total.date_multiplier = net_multiplier` is applied after the price factor and before the capacity / 15%-of-metro cap.
- `/weather` keeps its own holiday flag (weight .05) and directory-based competition; it does not use this module yet.
- `/competitors` measures real competing festivals from the directory; the competition penalty here is a generic "busy night" assumption on top.
