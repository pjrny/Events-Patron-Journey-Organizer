# Historic shows — `talent-history.v1`

Lets an organizer add their own past shows so the Talent Draw Estimator and the Festival Simulator use **real ticket
sales** for the "past draw" signal (base weight .30, the strongest) instead of leaving it empty.

## Where the data lives

| Visitor | Storage | Notes |
|---|---|---|
| Signed in to the organizer dashboard (session cookie or `pj_token` bearer) | D1 table `talent_history` (migration 0007), keyed by `organizer_id` | private: only that organizer can list/delete; max 2,000 rows |
| Signed out | browser `localStorage["pj_talent_history_v1"]` (max 500 rows) | never leaves the browser except inside a draw request |

When signed in with browser rows present, the widget offers **"Move N browser rows to my account"**.

## API (organizer session required)

- `GET /api/talent/history` → `{ schema, storage:"account", organizer, rows:[…] }`
- `POST /api/talent/history` `{ rows:[…], replace?:true }` → `{ added, dropped }` (≤500 rows per call)
- `DELETE /api/talent/history?id=<id>|all`

Row fields: `artist` (required), `city` ("Austin, TX"), `date` (YYYY-MM-DD or m/d/yyyy), `venue`, `capacity`,
`tickets_sold`, `gross`, `fee_paid`, `notes`. A row needs `tickets_sold` or `fee_paid`.

## Import (shared widget `/pj-history.js`, src/history_widget.ts)

Paste from Excel/Google Sheets (tab-separated), CSV, `|` or `;`; or upload `.csv/.tsv/.xlsx` (XLSX parsed in the browser
with SheetJS, loaded on demand). Header names are matched loosely (e.g. "tickets sold / sold / paid attendance",
"fee / guarantee / artist fee", "gross / box office"). Without a header the template order is assumed:
`artist, city, date, venue, capacity, tickets_sold, gross, fee_paid`. A template CSV is downloadable from the widget.

## How rows feed the model (talent-draw.v2)

Draw requests carry `history: [rows]` (the rows shown in the widget). For each lineup act, matching rows
(normalized name equality), newest first, up to 5 with `tickets_sold`:

- **Ignored** if older than 5 years; **×0.85** if 3–5 years old.
- **Geo discount**: same city 1.0; same metro (both cities in the metro table with the same population, e.g. Dallas/Fort Worth) 0.85;
  same state 0.6; otherwise 0.4.
- **Quality**: `actual_sales` 1.0.
- **Value**: the v in [0,1] solving `headliner_scale × v³ × (0.05 + 1.6·v) = tickets_sold`, i.e. on its own the model
  reproduces the tickets you sold. Blended with the other signals by the usual weights.
- Effect on confidence: one same-city sales row adds .30 effective weight, which is usually the difference between "Very low" and "Medium".
- `fee_paid` rows are listed next to the pay estimate ("You paid $X (date, $/ticket)") and flag budget shares far below a past fee.
- Average ticket price from your rows (Σgross / Σtickets) is used for the pay market range when you don't enter a ticket price.

**Privacy:** any request with history or a budget is *private*: not written to `talent_results`, no 7-day cache reuse, no permalink.

Tip: use shows where the act headlined; for co-bills enter your best estimate of that act's share of tickets.
