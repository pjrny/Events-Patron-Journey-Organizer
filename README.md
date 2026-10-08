# Events-Patron-Journey-Organizer

Organizer platform for Patron Journey events. Runs as the Cloudflare Worker **`events-patronjourney`** on `workers.dev` and sits in front of **Odoo Online** (`patronjourney.odoo.com`, Odoo 19.0+e).

- **Odoo** is the source of truth: events, tickets, registrations, attendees, venues, tracks (speakers), booths (vendors), sponsors, emails, QR codes, check-in.
- **Worker** is the organizer dashboard and API gateway: auth, ownership, create/edit/archive events, scanner.
- **D1** stores ownership, sessions, and audit only. **KV** is a cache only.
- Attendees keep using the native Odoo event pages.

## Status: slice 3 (scanner + attendees) — deployed, unit test plan 30/30

Check-in scanner (`/dashboard/checkin`, `POST /api/organizer/events/:id/checkin`), attendee list (`GET /api/organizer/events/:id/attendees`), archive now unpublishes first. Full end-to-end unit test (organizer PIN login → create/publish event 17 → 3 native website registrations → 2 check-ins + duplicate rejected → archive): [`docs/UNITTEST.md`](docs/UNITTEST.md).

### Slice 2 (auth + create event)

Auth (magic link via Odoo mail + email/PIN → JWT), ownership-gated organizer API, create/edit/publish/archive events by copying Testival (14), minimal dashboard at `/dashboard`. Details, API and smoke results: [`docs/SLICE2.md`](docs/SLICE2.md).

### Slice 1 (scaffold)

Live: https://events-patronjourney.message-0ad.workers.dev · D1 `events-patronjourney-db` · KV **not bound yet** (deploy token lacks Workers KV Storage: Edit; cache helpers no-op until it is). Probe results: [`docs/PROBE_RESULTS.md`](docs/PROBE_RESULTS.md).

| Route | Auth | Purpose |
|---|---|---|
| `GET /` , `GET /dashboard` | public | placeholder pages |
| `GET /health` | public | bindings, D1 schema bootstrap, whether an Odoo key is bound (true/false only) |
| `GET /api/config` | public | paid-upgrade URL and ticket types |
| `GET /api/admin/diag` | `Bearer ADMIN_TOKEN` | secret **names**, Odoo key binding **name**, D1 counts, KV round trip |
| `GET /api/admin/odoo/probe[?full=1]` | `Bearer ADMIN_TOKEN` | read-only Odoo JSON-2 probe: plan/auth check, field map, Testival (event 14) summary, websites, templates, tags |
| `POST /api/admin/odoo/probe-write?confirm=yes` | `Bearer ADMIN_TOKEN` | copies event 14 **once** into "PJ Organizer API Probe", sets it unpublished, reports what the copy carried over, archives it |

Next slices: attendee registration + check-in scanner unit test, speakers/vendors management, attendee list. See [`docs/PLAN.md`](docs/PLAN.md).

## Layout

```
wrangler.jsonc          Worker config (workers.dev only, D1 = DB, KV = CACHE, keep_vars)
migrations/0001_init.sql D1 schema (also self-applied by the Worker on first request)
src/index.ts            router
src/odoo.ts             Odoo 19 JSON-2 client (POST /json/2/<model>/<method>, bearer key)
src/probe.ts            Odoo discovery + one-off write probe
src/db.ts               schema bootstrap, ownership gate, audit log
src/cache.ts            KV cache helpers (cache only)
src/crypto.ts           HS256 JWT, PBKDF2 PIN hashing, constant-time compare
src/auth.ts             magic link, PIN, sessions, JWT gate
src/events.ts           create/update/publish/archive events on Odoo
src/mail.ts             outbound mail via Odoo mail.mail
src/time.ts             local <-> UTC for Odoo datetimes
src/dashboard.ts        minimal organizer dashboard HTML
docs/                   plan, Odoo API map, deploy notes
```

## Secrets (Cloudflare → Worker → Settings → Variables and Secrets)

Values are never committed, logged, or returned. The Worker reads them as bindings.

| Name | Used for |
|---|---|
| `ODOO` — Odoo admin API key (var `ODOO_KEY_BINDING` names it; `ODOO_API_KEY` etc. also accepted) | JSON-2 calls (admin user for now; move to a dedicated bot user) |
| `ADMIN_TOKEN` | gates `/api/admin/*` |
| `JWT_SECRET` | organizer session JWTs |
| `PIN_PEPPER` | PIN hashing pepper |
| `TEST_ORGANIZER_PIN` | smoke-test PIN for `organizer+test@pjrny.com` (seeded via `POST /api/admin/organizers`) |
| `ORGANIZER_TEST_PASSWORD`, `ATTENDEE_TEST_PASSWORD` | end-to-end tests with `organizer+test@pjrny.com` / `attendee1+test@pjrny.com` |

## Develop / deploy

Requires Node 22+.

```bash
npm ci
cp .dev.vars.example .dev.vars   # local only
npm run dev                      # http://127.0.0.1:8787/health
npx wrangler login               # or CLOUDFLARE_API_TOKEN
npm run deploy                   # first deploy auto-creates the D1 db + KV namespace; commit the ids written into wrangler.jsonc
npm run db:migrate:remote        # optional, the Worker self-applies 0001 anyway
BASE_URL=https://events-patronjourney.<subdomain>.workers.dev ADMIN_TOKEN=... npm run smoke
ADMIN_TOKEN_FILE=... TEST_ORGANIZER_PIN_FILE=... npm run smoke:slice2   # auth + create event, archives the test event
```

CI (optional): copy `docs/github-actions-deploy.yml.example` to `.github/workflows/deploy.yml` (the push token used for the scaffold lacked the `workflow` scope). It typechecks every push to `main` and deploys when the repo secret `CLOUDFLARE_API_TOKEN` exists.

Paid tier (paid tickets, POS, RFID, mobile apps, advanced attendance): https://www.pjrny.com/#Contact-us
