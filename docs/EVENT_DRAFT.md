# event-draft.v1: Festival Forecaster → Organizer Worker

The contract between the simulator repo (`pjrny/forecast_sim_event`) and this Worker. Schema: [`event-draft.v1.schema.json`](event-draft.v1.schema.json). Server-side validation in `src/drafts.ts` is authoritative; errors are `400 {"ok":false,"error":"invalid_draft","message":"<field>: <reason>"}`.

**The owner is never in the payload.** It always comes from the signed-in session. Payloads with `owner`, `organizer_id`, `email` and similar fields are rejected.

## Payload

```json
{
  "version": "event-draft.v1",
  "name": "Houston Bass Fest",
  "start": "2026-11-14T17:00",
  "end": "2026-11-14T23:00",
  "timezone": "America/Chicago",
  "venue": { "name": "Warehouse 9", "street": "100 Main St", "city": "Houston", "state": "TX", "zip": "77002" },
  "capacity": 500,
  "description": "optional plain text",
  "tags": ["Festival", "EDM"],
  "image": "https://… | data:image/png;base64,… | raw base64",
  "tickets": [{ "name": "GA – Pay at Door $199", "price": 199, "max": 500 }, { "name": "VIP – Pay at Door $299", "price": 299 }],
  "lineup": [{ "name": "Headliner", "start": "2026-11-14T21:00", "end": "2026-11-14T23:00" }],
  "forecast": { "any": "opaque simulator output" }
}
```

Required: `version`, `name`, `start`, `end`, `venue.name`, `capacity`. `timezone` defaults to `America/Chicago`. Times are local wall-clock in `timezone`, or ISO with Z/offset. The request cap is about 1 MB, and the image cap is 5 MB decoded.

## Field → Odoo map

| Draft field | Odoo | Notes |
|---|---|---|
| `name` | `event.event.name` | Event is a copy of the Testival template (id 14) |
| `start` / `end` + `timezone` | `date_begin` / `date_end` (UTC), `date_tz` | end > start |
| `venue.*` | `event.event.address_id` → `res.partner` (name, street, city, state_id, zip, country US) | Reuses an existing venue with the same name and city |
| `capacity` | `seats_limited=true`, `seats_max`; every ticket's `seats_max` | 1–100000 |
| `description` | `description` (HTML paragraphs) | |
| `tags[]` | `tag_ids` → `event.tag` | Missing tags are auto-created |
| `image` | `ir.attachment` + `cover_properties` background | URLs are fetched at create time. If that fails, it's a warning, not an error |
| (always) | `event.event.ticket` "General Admission", price 0 | |
| `tickets[].name` | `event.event.ticket.name`, **price forced to 0**, `seats_max = capacity` | Names are kept exactly as given ("GA – Pay at Door $199"). `price`/`max` are accepted but ignored |
| `lineup[]` | One `event.track` per named act (`name`, `partner_name`, `date`, `duration`, location = venue) | Rows with blank names are skipped. With no named acts, one default track named after the event spans start–end. Sets must fall inside the event |
| `forecast` | **not sent** | Stored with the draft in D1 only |
| (session) | `organizer_id` = organizer's partner; D1 `organizer_events` ownership | |
| (defaults) | website 1 (patronjourney.com), PATRON JOURNEY sponsor, template mail schedule | Created **unpublished**. Publish from the dashboard (or pass `{"publish":true}` to create) |

## Endpoints

| Method / path | Auth | Result |
|---|---|---|
| `POST /api/drafts` | none. CORS only for `https://pjrny.com` and `https://www.pjrny.com`. 30 per IP per hour | `201 {draft_id, claim_token, expires_at, claim_url}`. Expires in 7 days |
| `POST /api/organizer/drafts` | session | `201 {draft_id}` |
| `GET /api/organizer/drafts/:id` | owner only (others get 404) | `{draft_id, payload, created_at, claimed_at, created_event_id}` |
| `POST /api/organizer/drafts/:id/claim` `{claim_token}` | session | Attaches an anonymous draft (used by the claim page after PIN login) |
| `GET /claim?draft=&t=` | page | Signed in: attaches the draft and shows a confirm page with **Create free event (pay at door)** and **Create paid event** (links to https://www.pjrny.com/#Contact-us). Signed out: shows the pjrny.com signup/login steps plus email link / PIN forms |
| `POST /api/organizer/drafts/:id/create` | owner | `201 {odoo_event_id, dashboard_url, public_url, tickets, track, warnings}`. Calling it again returns `200 {reused:true, …same id}`. A concurrent call gets `409 create_in_progress` |

Errors: `invalid_draft` 400, `invalid_claim` 400/404, `already_claimed` 409, `expired` 410, `too_large` 413, `rate_limited` 429, `cors` 403, `unauthorized` 401, `csrf` 403.

### Signed-out flow (no cookies)

1. The embed on pjrny.com posts `POST /api/drafts` and opens `claim_url` in a new tab.
2. The claim page asks them to sign in. The email-link request carries `{email, draft, t}`. The claim token is verified then, and the draft id is stored in `auth_link_drafts`, keyed by the same token hash as the `magic_links`/`signup_links` row.
3. Verifying the link (`POST /auth/magic`) attaches the draft to whoever verified it and redirects to `/claim?draft=<id>`, which is already signed in.
4. Create → redirect to `dashboard_url`.

Claim tokens are single-use. Only their SHA-256 is stored, and they're cleared on claim.

## Smoke

`ADMIN_TOKEN_FILE=… TEST_ORGANIZER_PIN_FILE=… npm run smoke:drafts` runs 39 checks: CORS, validation, invalid/expired/reused tokens, claim through the sign-in link, create, idempotent create, Odoo fields, $0 pay-at-door tickets, lineup tracks, blank-lineup default track, the signed-in path, and archiving. Proof is in `docs/drafts-proof/results.json`.
