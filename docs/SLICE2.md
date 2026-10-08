# Slice 2: organizer auth + create event (deployed 2026-10-07 CT)

Live: https://events-patronjourney.message-0ad.workers.dev (version `0.2.0-slice2`). Smoke: 21/21 passed (`scripts/smoke-slice2.mjs`).

## Auth

| Route | Body | Result |
|---|---|---|
| `POST /api/auth/magic-link` | `{email}` | Always `200` "if that email belongs to an organizer..." (no enumeration). For an active organizer: stores `sha256(token)` in `magic_links` (15 min, single use), creates + sends an Odoo `mail.mail` (auto-deleted after send, since it carries the link). Delivery status goes to `audit_logs` (`auth.magic_link_sent`). 5 requests / 15 min / email, then `429`. |
| `GET /auth/magic?token=…` | | Confirm page with a **Sign in** button. GET does not consume the token (mail scanners pre-fetch links). |
| `POST /auth/magic` | form `token` | Consumes token → session + JWT cookie → `303 /dashboard`. |
| `POST /api/auth/magic/verify` | `{token}` | JSON variant: `{token, expires_at, organizer}` + cookie. |
| `POST /api/auth/pin` | `{email, pin}` | PBKDF2-SHA256 (100k) + `PIN_PEPPER`. 5 failures / 15 min / email → `429` (reset by a successful PIN login). |
| `POST /api/auth/logout` | | Revokes the session row; clears cookie. |
| `GET /api/auth/me` | | Current organizer. |
| `POST /api/organizer/pin` | `{pin}` | Organizer sets/changes own PIN (6-12 digits). |

Session = HS256 JWT (`sub`, `sid`, `email`, `role`, 12 h) **and** a `sessions` row (revocable). Sent as `Authorization: Bearer <jwt>` or the `pj_session` cookie (`HttpOnly; Secure; SameSite=Lax`). Cookie-authenticated writes must come from the same origin (CSRF guard).

### How the smoke test logs in
- Organizer `organizer+test@pjrny.com` is seeded by `POST /api/admin/organizers {email, pin_from_env: "TEST_ORGANIZER_PIN"}` (admin token). It links Odoo partner **37263** / user **187** and sets the PIN hash from the Worker secret `TEST_ORGANIZER_PIN`.
- The PIN value lives only in the Worker secret and the operator's local file (box: `~/.config/pj-organizer/TEST_ORGANIZER_PIN`). Never committed.
- `ORGANIZER_TEST_PASSWORD` is the Odoo **portal** password; the dashboard does not use it.
- Magic-link verify is exercised with `POST /api/admin/organizers/magic-link` (admin-only; mints a token without emailing it). The real email path is exercised separately by `POST /api/auth/magic-link`.

## Organizer API (JWT required on every route)

| Route | Notes |
|---|---|
| `GET /api/organizer/events` | Owned events (D1) joined with Odoo name/dates/seats/published. |
| `POST /api/organizer/events` (alias `POST /api/events`) | Create. JSON, or multipart with `data` (JSON) + `image` file. |
| `GET /api/organizer/events/:id` | Ownership-gated summary: event, tickets, tracks, sponsors, registration counts by state, public + backend URLs. |
| `PATCH /api/organizer/events/:id` | Any create field (partial). Capacity re-caps event + tickets; ticket flags add/remove types (types with registrations are never deleted, sales are closed instead); `speaker` adds a track. |
| `POST /api/organizer/events/:id/publish` | `{published: true|false}` → `website_published`. |
| `POST /api/organizer/events/:id/archive` | `action_archive` in Odoo (never delete) + D1 `status='archived'`. |

Every event route checks `organizer_events (organizer_id, odoo_event_id)`; no row → `403`.

### Create body
```json
{
  "name": "Patron Journey Test Festival",
  "description": "plain text, blank lines = paragraphs",
  "tags": ["Festival"],                       // Festival | Community | Music | Networking | Conference (missing ones are created in tag category of "Festival")
  "start": "2026-11-14T17:00", "end": "2026-11-14T22:00",   // local wall clock in `timezone`, or ISO with offset
  "timezone": "America/Chicago",
  "website_id": 1,                            // 1 Patron Journey (company 1) | 2 pjrny (company 3)
  "capacity": 100,
  "venue": {"name": "Houston Test Venue", "street": "1 Test St", "city": "Houston", "state": "TX", "zip": "77002", "country": "US"},  // or {"id": <existing venue partner>}
  "tickets": {"pay_at_door": true, "volunteer": true, "staff": true},
  "speaker": {"name": "Main Artist", "start": "2026-11-14T18:00", "end": "2026-11-14T19:00"},
  "publish": false,
  "image": {"data_base64": "...", "mimetype": "image/png", "filename": "cover.png"}
}
```

### What create does in Odoo
1. Validates input; resolves website→company, tags, venue **before** copying.
2. `event.event/copy {ids:[14], default:{name, website_published:false}}`.
3. Inserts `organizer_events` ownership immediately; audit `event.created`.
4. `write`: name, description, subtitle, dates (UTC), `date_tz`, `website_id`, `company_id`, `address_id`, `seats_limited/seats_max`, `tag_ids`, `organizer_id` = organizer's Odoo partner.
5. Tickets: GA → "General Admission"; "GA Pay at Door" → "Pay At Door" (or removed); VIP types unlinked (fresh copy, no registrations); Volunteer/Staff created on product 36. All `$0`, `seats_max = capacity`.
6. Sponsor: copies the template's PATRON JOURNEY sponsor record (partner 20, type 4) onto the new event.
7. Track: one track from `speaker` (or "Main Event" spanning the event), `location_id` = `event.track.location` named after the venue (found or created), published.
8. Image: public `ir.attachment` on the event + `cover_properties.background-image` (what the website editor does).
9. `website_published: true` only if `publish`.
10. Any failure after the copy → the copy is **archived** and the ownership row marked archived; audit `event.create_failed`.

Venues: a res.partner is reused only if it is already some event's `address_id` (organizers cannot attach arbitrary contacts by id).

## Admin helpers (Bearer ADMIN_TOKEN)
`POST /api/admin/organizers`, `POST /api/admin/organizers/magic-link`, `GET /api/admin/audit?limit=`, `GET /api/admin/ownership[?odoo_event_id=]`, `POST /api/admin/odoo/read` (read-only: `search_read|read|search_count|fields_get` on `event.*`, `mail.mail`, `website`, `res.partner`, `res.country(.state)`, `ir.attachment`).

## Smoke run (2026-10-07 ~21:20 CT)
- Magic-link mail: Odoo `mail.mail` 65427 created, sent, auto-deleted (status `sent`) to organizer+test@pjrny.com.
- Created event **16** "Patron Journey Test Festival": 2026-11-14 5-10 PM CT, capacity 100, venue partner **37265** "Houston Test Venue" (new), track location 4, tickets GA 2465 / Pay At Door 2467 / Volunteer 2469 / Staff 2470 (VIP + VIP Pay at Door removed), sponsor 6 (PATRON JOURNEY), track 6 "Main Artist" 6-7 PM CT, cover attachment 49376, website 1, unpublished, organizer = partner 37263.
- D1 ownership row → organizer 1. Foreign event → 403. Event 16 then **archived** (active=false), not deleted.
- PIN lockout: 5×401 then 429. Logout revokes the JWT.

## Known gaps / next
- `website_menu` stays as copied (false), so the event's Tracks/Sponsors sub-pages are not in the event menu; tracks still exist. Decide in Odoo whether the template should have the website menu on.
- Magic-link sender is the Odoo default for the API user (admin). Set var `MAIL_FROM` to e.g. `"Patron Journey <events@pjrny.com>"` once that address is an allowed sender in Odoo.
- The Houston Test Venue partner (37265) and track location 4 stay in Odoo and will be reused by later tests.
