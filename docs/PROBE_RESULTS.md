# Odoo probe results — 2026-10-07 (CT)

Run against `https://events-patronjourney.message-0ad.workers.dev` using the dashboard secret `ODOO` (admin API key, uid 2).

## Read probe (`GET /api/admin/odoo/probe`)

- Odoo **19.0+e**, JSON-2 external API **allowed** (no plan block, key accepted). Context tz `America/Chicago`, lang `en_US`.
- Every expected field exists except `event.booth.description` and `event.type.seats_limited` (neither is needed).
- `event.registration.state` selection: `draft`, `open`, `done`, `cancel` → check-in = set `done` ("Attended").
- Websites: **1 = Patron Journey** (`https://www.patronjourney.com`, company 1 "Admin"); **2 = pjrny** (`https://www.pjrny.com`, company **3** "pjrny"). Events on pjrny probably need `company_id = 3`.
- Event templates (`event.type`): only id 1 "htown intl story fest". Testival is not an `event.type`.
- Event tags: 6 Festival, 5 Community, 4 Adoption (category 1 "Events"). Music / Networking / Conference do not exist yet.

### Testival (event.event 14)

| Field | Value |
|---|---|
| dates | 2029-12-31 14:30 → 2030-01-01 14:30 (UTC as stored), tz America/Chicago |
| seats | limited, max 100 |
| venue (`address_id`) | 37262 "VENUE" (placeholder) |
| organizer / user / company | Admin / Admin / 1 |
| website | 1 Patron Journey, **unpublished**, `website_menu` false |
| stage | 3 Announced, registrations open |
| tags | 6 Festival |
| tickets | GA, VIP, GA Pay at Door, VIP Pay at Door — all $0, product 36 "Event Registration", seats_max 10000 each |
| tracks | 5 "EVENT" (published, no date/speaker) |
| booths | 3 "VENDOR" (Standard Booth, available) |
| sponsors | 5 "PATRON JOURNEY" (partner 20, type Sponsor, published) |
| mail schedulers | template 62 right after registration; template 63 at 3 days and 1 hour before |
| registrations | 0 |

## Write probe (`POST /api/admin/odoo/probe-write?confirm=yes`)

Copied 14 → **event 15 "PJ Organizer API Probe"**, set unpublished, archived.

| Model | Template | Copy |
|---|---|---|
| event.event.ticket | 4 | 4 |
| event.mail | 3 | 3 |
| event.booth | 1 | 1 |
| event.track | 1 | **0** |
| event.sponsor | 1 | **0** |

So `copy()` keeps tickets, reminder/confirmation mails and booths, but the Worker must recreate the Patron Journey sponsor (partner 20, sponsor type 4) and any default tracks after each copy, and must rename/trim/re-cap the copied tickets.
