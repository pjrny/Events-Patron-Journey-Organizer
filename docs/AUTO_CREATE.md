# Organizer self-service onboarding (auto-create)

Anyone who has signed up / signed in on **pjrny.com** (an Odoo `res.users` account, normally a portal user)
can become an organizer with no admin step.

## Flow

1. Organizer opens the dashboard (e.g. embedded on https://www.pjrny.com/organizers) and requests an email sign-in link.
2. `POST /api/auth/magic-link`
   - Existing active organizer → normal sign-in link (unchanged).
   - Not an organizer, but an active Odoo `res.users` exists for that email (exact, case-insensitive match on
     `login`, else `email`) → a one-time **onboarding link** is emailed via Odoo `mail.mail`. Stored in D1
     `signup_links` (hash only). **No organizer row yet.**
   - No Odoo user → `404 {error:"signup_required"}` with the "sign up / sign in on pjrny.com first" message.
     Contacts (`res.partner`) without a user account do **not** qualify.
3. Clicking the link (`POST /auth/magic` or `POST /api/auth/magic/verify`) re-checks Odoo, inserts the
   `organizers` row (`odoo_partner_id`, `odoo_user_id`, `display_name`, role `organizer`, active 1), writes
   audit `organizer.auto_created`, and starts a session. A disabled organizer is never reactivated.
4. Dashboard shows **Set your organizer PIN** when `pin_set` is false → `POST /api/organizer/pin`.

PIN login for a brand-new organizer (or any organizer without a PIN) returns `409 pin_not_set`
("use an email sign-in link first"). Unknown emails on PIN login return `404 signup_required`.

## Account preference when several users match

1. `res.users.website_id` = `ORGANIZER_SIGNUP_WEBSITE_ID` (2 = pjrny.com)
2. user in the pjrny website's company (company 3) — today every pjrny signup has `website_id` empty, so this is the real signal
3. portal (`share=true`) before internal users
4. `login` match before `email` match

## Admin helpers

- `GET /api/admin/odoo-account?email=` — read-only: which Odoo account an email would onboard from, and its D1 organizer.
- `POST /api/admin/organizers/magic-link` — for a non-organizer with an Odoo account, mints the onboarding link
  (not emailed); `404 signup_required` otherwise.

## Smoke

`scripts/smoke-autocreate.mjs` — 25/25 on 2026-10-07 with `attendee1+test@pjrny.com` (res.users 188, partner 37264, company 3).
