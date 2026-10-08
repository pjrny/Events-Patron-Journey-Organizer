# Odoo API map (Odoo 19.0+e, JSON-2)

Endpoint: `POST https://patronjourney.odoo.com/json/2/<model>/<method>`
Headers: `Authorization: bearer <key>`, `Content-Type: application/json`. `X-Odoo-Database` only if the host serves several DBs (not the case today).
Body: named arguments only, plus `ids` and `context`. Each call is its own transaction.

> **Plan requirement:** Odoo documents that external API access on Odoo Online is only available on the **Custom** plan (not One App Free / Standard).
> Verified so far (2026-10-07, unauthenticated): server is `19.0+e`; `/json/2/...` is live and answers `401 User not authenticated, use an API Key` without a key, and `401 Invalid apikey` for a bad key. Whether the real key works (or hits a plan block) needs the in-Worker probe (`GET /api/admin/odoo/probe`).

Status legend: **expected** = standard Odoo 19 field, still to be confirmed by `/api/admin/odoo/probe` (it returns `field_map[model].fields` and `missing_expected`).

## event.event (event 14 = Testival = template)
| Dashboard field | Odoo field | Type | Status |
|---|---|---|---|
| Event name | `name` | char (required) | expected |
| Description | `description` | html | expected |
| Subtitle | `subtitle` | char (website_event) | expected |
| Image | `cover_properties` (JSON: background-image url) | text | expected; upload via `ir.attachment` then set cover |
| Tag | `tag_ids` | many2many:event.tag | expected |
| Start / End | `date_begin`, `date_end` | datetime, **UTC** `YYYY-MM-DD HH:MM:SS` | expected |
| Timezone | `date_tz` | selection | expected |
| Venue | `address_id` | many2one:res.partner | expected |
| Capacity | `seats_limited` = true, `seats_max` = N | boolean, integer | expected |
| Website | `website_id` | many2one:website | expected |
| Published | `is_published` | boolean | expected |
| Organizer contact | `organizer_id` | many2one:res.partner | expected |
| Template | `event_type_id` | many2one:event.type | expected |
| Archive | `action_archive` / `active` = false | method / boolean | expected |
| Duplicate | `copy(ids=[14], default={...})` | method → new id | expected |

## event.event.ticket
| Field | Odoo | Notes |
|---|---|---|
| name | `name` | "General Admission", "Pay At Door", "Volunteer", "Staff" |
| event | `event_id` | |
| price | `price` | always `0` on free tier (event_sale) |
| product | `product_id` | required when event_sale is installed; reuse template ticket's product |
| cap | `seats_limited`, `seats_max` | set from organizer capacity (Testival tickets are 10,000 each today) |
| sale window | `start_sale_datetime`, `end_sale_datetime` | optional |

## event.registration (attendees + check-in)
| Field | Odoo | Notes |
|---|---|---|
| attendee | `name`, `email`, `phone`, `partner_id` | created natively by Odoo website registration |
| event / ticket | `event_id`, `event_ticket_id` | |
| status | `state` | `draft` (unconfirmed), `open` (registered), `done` (attended / checked in), `cancel` |
| QR / barcode | `barcode` | the ticket QR encodes this value |
| check-in | `action_set_done` or `write {state: 'done'}`; native desk helper `register_attendee(barcode, event_id)` | verify which is callable via JSON-2 |

Scanner logic: search `event.registration` by `barcode` → ownership check on `event_id` in D1 → `done` already? "Already Checked In" : `cancel`/not found? "Invalid Ticket" : set `done` → "Checked In".

## event.track (speakers / schedule)
`name`, `event_id`, `partner_id` / `partner_name` / `partner_email` / `partner_biography`, `date` (UTC), `date_end` or `duration` (hours), `location_id`, `stage_id`, `is_published`, `website_image`.

## event.booth (vendors)
`name`, `event_id`, `booth_category_id` (required), `state` (`available` / `unavailable`), `partner_id`, `contact_name`, `contact_email`, `contact_phone`.

## event.sponsor (fixed "Patron Journey" sponsor)
`event_id`, `partner_id`, `sponsor_type_id`, `url`, `is_published`, `exhibitor_type`. Recreated after copy if the copy drops it.

## res.partner (venues, organizer contacts)
Venue: `name`, `street`, `city`, `state_id` (res.country.state), `zip`, `country_id`, `type`, `is_company`. Organizer contact: `name`, `email`, `user_ids`.

## website
`name`, `domain`, `company_id`. Patron Journey (`patronjourney.com`) and pjrny (`pjrny.com`) ids come from the probe.

## Reference
- event.tag: `name`, `category_id` (required, event.tag.category)
- event.type (Odoo event templates): `name`, `event_type_ticket_ids`, `event_type_mail_ids`
