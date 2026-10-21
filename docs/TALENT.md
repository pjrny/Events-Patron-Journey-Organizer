# Talent Draw Estimator (`/talent`) — `talent-draw.v1`

Public, free, deterministic (no AI). Paste a lineup + city → estimated draw per artist and for the bill.

## Routes
| Route | |
|---|---|
| `GET /talent` | Page (embeddable on pjrny.com; same frame-ancestors as `/weather`) |
| `GET /talent/r/:id` | Permalink (`td_…`), server-rendered with OG/Twitter tags |
| `GET or POST /api/talent/draw` | JSON. POST body JSON or form; GET query params |

Inputs: `lineup` (newline/comma separated, max 40; optional fee `Artist | 25000`, `Artist = 25k`), `city` (geocoded via the cached Nominatim helper), `date` (YYYY-MM-DD, optional), `capacity`, `genre`, `price` (or `ticket_price`).

**Incremental lookups.** Each call has an external-fetch budget (38, MusicBrainz 8 at ≤1 req/s). If the lineup is not fully looked up the response is `{ok:true, incomplete:true, pending, total, message}`; call again with the same body (source data is cached per artist in `talent_source_cache` for 7 days). The page does this automatically.

Caching: complete results are reused for 7 days by input (`talent_results`); results where a source failed get a permalink but are not reused. Rate limit: 60 uncached rounds per IP per hour (`api_rate`).

## Sources
| Source | Key | Category | Geo | Quality |
|---|---|---|---|---|
| Deezer `search/artist` `nb_fan` | none | listening | global 0.2 | streaming/fans 0.5 |
| Google News RSS `"artist" "city" when:90d` (GNews API if `GNEWS_KEY`) | none | press | city 1.0 | press 0.3 |
| MusicBrainz artist area / begin-area / country, tags | none (UA info@pjrny.com) | tour/local presence | city / region / country | press 0.3 |
| iTunes Search primary genre | none | genre tags | – | – |
| Patron Journey `festival_directory` (music festivals ≤100 km, genre share, same month) | – | genre fit | metro 0.85 | 0.5 |
| Last.fm `artist.getinfo` listeners; `geo.gettopartists` country rank | `LASTFM_KEY` | listening | global / country | 0.5 |
| SeatGeek `/2/performers` score; `/2/events?performers.slug&lat&lon&range=50mi` score, prices | `SEATGEEK_CLIENT_ID` | upcoming demand | global / metro | demand 0.8 |
| Ticketmaster Discovery `events.json` keyword + latlong radius 50 mi, stateCode | `TICKETMASTER_KEY` | tour presence, upcoming demand (price) | metro / region | 0.6 / 0.8 |
| Bandsintown `/artists/{name}` tracker_count; `/events?date=upcoming` | `BANDSINTOWN_APP_ID` | fan intent, tour presence | global / metro | 0.6 |

Add a key with `npx wrangler secret put LASTFM_KEY` (etc.); the adapter turns on with no code change. "Past draw in market" (base 0.30) has no source yet: it needs real sales history (Odoo / Master Budgets).

## Scoring
- Each signal value is normalized 0–1 (log scales: Deezer fans 300→5M, Last.fm listeners 1k→4M, trackers 500→2M; press log1p(n)/log1p(100); SeatGeek score/0.75; genre share×1.5).
- Effective weight = base × geo × quality. Base: past draw 0.30, upcoming demand 0.20, tour presence 0.10, fan intent 0.15, listening 0.15, press 0.05, genre fit 0.05. Geo: city 1.0, metro 0.85, region 0.6, country 0.4, global 0.2. Quality: sales 1.0, demand 0.8, tracker 0.6, streaming/fans 0.5, press/social 0.3.
- Within a category, signals average weighted by their discount; category weight = base × best discount. Score = renormalized weighted mean. Confidence = sum of available effective weight (max 1.0).
- Popularity gate: context signals cannot create demand. `gate = clamp(0.05 + 1.6 × popularity)` where popularity = weighted mean of past draw, upcoming demand, fan intent, listening.
- `draw_i = headliner_scale × score³ × gate`, headliner_scale = clamp(0.6% × metro population, 2,500, 60,000).
- Range: ± spread, spread = clamp(0.15 + 0.7 × (1 − min(1, confidence/0.5)), 0.15, 0.85).
- Lineup total = Σ draw_i / rank_i (sorted by draw) × price factor (clamp((ref/price)^0.35, 0.6, 1.3), ref = market price hint or $65), capped by min(capacity, 15% metro population).

## `talent-draw.v1` (stable fields)
```jsonc
{
  "schema": "talent-draw.v1", "ok": true, "id": "td_…", "permalink": "/talent/r/td_…", "cached": false,
  "input": { "city", "date", "capacity", "genre", "ticket_price", "artists": [{ "name", "fee" }] },
  "location": { "city", "state", "country", "lat", "lon", "metro_population", "metro_population_known" },
  "headline": "…",
  "lineup_total": { "low", "mid", "high", "cap", "capped", "price_factor", "headliner_scale", "method" },
  "confidence": { "value", "label", "range_spread" },
  "artists": [{ "name", "fee", "found", "rank", "decay", "contribution", "score", "popularity", "popularity_gate",
                "confidence", "confidence_label", "draw": { "low", "mid", "high" }, "categories": { "<cat>": { "value", "effective_weight", "share" } | null },
                "signals": [{ "category", "source", "metric", "raw", "value", "geo", "quality", "base_weight", "geo_discount", "quality_discount", "effective_weight", "detail" }],
                "genres", "hometown", "links", "picture", "price_hint" }],
  "feed": ["…"],
  "simulator": {
    "attendance_base": { "low", "mid", "high" },   // replaces the simulator's flat attendance guess
    "attendance_sd": 0,                           // (high-low)/3.29 → variance for confidence bands
    "replace_flat_attendance": true,
    "per_artist": [{ "name", "rank", "contribution", "fee", "cost_per_expected_ticket" }],
    "lineup_cost": null, "cost_per_expected_ticket": null
  },
  "weights": { "base", "geo_discount", "quality_discount" },
  "sources_enabled": { … }, "disclaimer": "…", "notes": [], "links": { "plan_free", "paid" }
}
```

### Simulator integration
1. Simulator sends its lineup (names + fees) with city/date/capacity/genre/price to `POST /api/talent/draw`, repeating while `incomplete`.
2. `attendance_base.mid` replaces the flat attendance base; `attendance_sd` widens/narrows the bands.
3. Then apply `weather-risk.v1` `simulator` modifiers and `competitor-threat.v1` overlap on top.
4. Feed lines come from `feed`; cost check from `simulator.per_artist[].cost_per_expected_ticket`.

## Caveats
Spotify exposes no city streams; no API gives followers by city; worldwide data is discounted to 20%. Name matching is exact (normalized); ambiguous names may hit the wrong artist (e.g. "Mobley"). Artist names containing commas must be on their own line. iTunes Search often returns 429 to Cloudflare IPs and Google News RSS can time out; failures are retried once, then skipped and noted. Metro populations come from a built-in table (~70 metros); others assume 1M.
