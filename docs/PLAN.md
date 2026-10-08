# Build plan

## Slice 1 (this commit): scaffold
Worker + D1 schema (self-bootstrapping) + KV cache helpers + admin-gated Odoo probe. No production Odoo writes except the optional one-off probe copy.

## Slice 2: organizer auth
- `POST /api/auth/magic-link {email}` → organizer must exist & be active in D1 → store `sha256(token)` in `magic_links` (15 min) → send email (Odoo `mail.mail` create+send via JSON-2, from the admin key, or Cloudflare Email Routing/Resend; decide after probe) → always respond 200 (no account enumeration).
- `GET /auth/callback?t=...` → mark used → create `sessions` row → HS256 JWT (`sub`, `sid`, `email`, `role`, 12 h) in `HttpOnly; Secure; SameSite=Lax` cookie.
- `POST /api/auth/pin {email, pin}` → PBKDF2 verify → same session/JWT. Throttle: 5 failures / 15 min / email via `login_attempts`.
- `POST /api/auth/logout` → `sessions.revoked_at`.
- Seed: `organizer+test@pjrny.com` linked to its Odoo partner; test PIN set from secret.
- Note: `ORGANIZER_TEST_PASSWORD` is the Odoo **portal** password. The dashboard does not log in to Odoo as the organizer; it is used for the e2e test of the portal account only.

## Slice 3: create event (duplicate template → patch)
1. `event.event/copy {ids:[14], default:{name, website_id, is_published:false}}` → new id.
2. Insert `organizer_events (organizer_id, odoo_event_id, website_id)` immediately (so a half-built event is still owned) + audit `event.created`.
3. Venue: search `res.partner` by name+street+zip; else create → `address_id`.
4. `write` name, description, subtitle, tag_ids, date_begin/date_end (UTC from local + date_tz), date_tz, seats_limited/seats_max.
5. Tickets: unlink copied non-free tickets (VIP etc.) or keep only GA; ensure GA ($0, cap = capacity); add Pay At Door / Volunteer / Staff ($0) if chosen.
6. Re-create Patron Journey sponsor + default tracks if the copy dropped them (probe-write reports what carries over).
7. Image: `ir.attachment` create (base64, public) → set `cover_properties`.
8. Publish: `is_published: true` → return public URL.

Then: edit/archive, speakers (tracks), vendors (booths), attendees list, scanner, full unit test (3 registered / 2 checked in / 1 pending).
