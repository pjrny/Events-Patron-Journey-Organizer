# Unit test plan: results (slice 3, 2026-10-07 ~9:25 PM CT)

Live Worker: https://events-patronjourney.message-0ad.workers.dev (`0.3.0-slice3`).
Script: `scripts/unittest.mjs` (phases `create | register | mail | checkin | verify | archive | all`).
Proof JSON: `docs/unittest-proof/` (copied from `/workspace/pj-unittest/` on the box).

**Result: 30/30 checks passed.**

| Item | Value |
|---|---|
| Odoo event | **17** "Patron Journey Test Festival" (copied from Testival 14), 2026-11-14 5-10 PM CT, capacity 100, website 1 |
| Venue | partner **37265** "Houston Test Venue" (reused, not re-created) |
| Tickets | General Admission 2471, Pay At Door 2473, Volunteer 2475, Staff 2476 (all $0, cap 100) |
| Track / sponsor | track 7 "Main Artist" 6-7 PM CT at location 4; sponsor 7 PATRON JOURNEY (partner 20) |
| Public page (during test) | https://www.patronjourney.com/event/patron-journey-test-festival-17 |
| Register URL used | https://www.patronjourney.com/event/patron-journey-test-festival-17/register |
| Backend | https://patronjourney.odoo.com/odoo/events/17 |
| End state | **archived** (`active=false`) and **unpublished**; public URL now 404. Not deleted. |

## How attendees were registered: native website form (no API shortcut)
Each attendee was a fresh anonymous visitor (own cookie jar) doing exactly what the browser does:
1. `GET /event/<slug>/register` (session cookie + `csrf_token`; no reCAPTCHA/Turnstile on the page).
2. JSON-RPC `POST /event/<slug>/registration/new` with `nb_register-2471=1` (GA). Returns the attendee form; fields were `1-event_ticket_id`, `1-name-9`, `1-email-10`, `1-phone-11`.
3. `POST /event/<slug>/registration/confirm` (form-encoded, with csrf) → `303 /event/17/registration/success?registration_ids=…`.

| Attendee | Registration | Barcode (QR value) | Final state |
|---|---|---|---|
| attendee1+test@pjrny.com | 41619 | 5287448970230310227 | done (Checked In 9:25 PM CT) |
| attendee2+test@pjrny.com | 41620 | 2930877030294794526 | done (Checked In 9:25 PM CT) |
| attendee3+test@pjrny.com | 41621 | 4178897669233028115 | open (pending) |

Odoo's ticket QR encodes `event.registration.barcode` (`/report/barcode/QR/<barcode>` in the 19.0 badge template), which is what the scanner submits.

Confirmation mail: the "after registration" scheduler (event.mail 34, template 62) ran for all three (`event.mail.registration` `mail_sent=true`; `mail.message` "Your registration at Patron Journey Test Festival" `email_outgoing` on each registration; `mail.mail` 65428-65430 to the three addresses). At the time of the run they were `outgoing` (queued for Odoo's mail queue cron), so actual inbox delivery should be confirmed in the attendee1-3 mailboxes.

## Check-in (scanner API)
| Scan | Result |
|---|---|
| attendee1 | ✅ Checked In (`action_set_done`) |
| attendee1 again | ❌ Already Checked In |
| attendee2 | ✅ Checked In (`action_set_done`) |
| bogus barcode `1234567890123456789` | ❌ Invalid Ticket |
| attendee3's barcode on event 14 (not owned) | 403 |
| no JWT | 401 |

Every attempt is in `audit_logs` (`checkin.performed`, `checkin.duplicate`, `checkin.invalid`) with barcode, result, prior state and method.

## Final counts (`GET /api/organizer/events/17/attendees`)
`3 registered, 2 checked in, 1 pending` ✅

## Pass/fail
| Step | Check | Result |
|---|---|---|
| a | PIN login as organizer+test@pjrny.com issues JWT | PASS |
| b | create event (201) / published / capacity 100 / venue 37265 / D1 ownership / Main Artist track / PJ sponsor / public page anonymous 200 | 8 × PASS |
| c | 3 × native website registration / 3 × Odoo registration `open` + barcode / confirmation mail scheduled+queued for all 3 | 7 × PASS |
| d | attendee1 Checked In / attendee1 Already Checked In / attendee2 Checked In / bogus Invalid Ticket / foreign event 403 / no JWT 401 | 6 × PASS |
| e | 3 registered / 2 checked in / 1 pending / scans audited / `/dashboard/checkin` served | 5 × PASS |
| f | archived (active=false) / unpublished / public page gone | 3 × PASS |

## Scanner + attendee endpoints (new in slice 3)
| Route | Notes |
|---|---|
| `POST /api/organizer/events/:id/checkin` `{barcode}` | JWT + ownership (`organizer_events.odoo_event_id`). Looks up `event.registration` by barcode **within that event only** (incl. archived regs). `done` → `already_checked_in`; missing / archived / `cancel` → `invalid_ticket`; otherwise `action_set_done` (fallback `write {state:'done'}`), re-read to confirm → `checked_in`. Accepts raw barcode or a URL/text containing it. Always HTTP 200 with `{result, message, attendee}` for scan outcomes. |
| `GET /api/organizer/events/:id/attendees` | All registrations with status, ticket, barcode, check-in time (event tz) and counts `{registered, checked_in, pending, unconfirmed, cancelled}` (registered = non-cancelled). |
| `GET /dashboard/checkin[?event=ID]` | Camera scanner (html5-qrcode 2.3.8 from unpkg with SRI; QR + 1D barcodes), manual barcode entry, live attendee list with per-row "Check in" button, 3 s duplicate-scan debounce. Uses the session cookie (same-origin). |
| `POST /api/organizer/events/:id/archive` | Now **unpublishes first**, then archives. |

## Findings / Odoo-side follow-ups (Muse/Kimi)
1. **Attendees are not linked to contacts.** Anonymous website registrations get `partner_id = false` (Odoo standard for public visitors), so attendee1's existing contact 37264 is not attached and no new contacts are created. The checklist item "Attendee contacts created automatically" is therefore *not* met by native Odoo. Options: attendees log in (portal) before registering, or add an Odoo automation (on `event.registration` create: find/create `res.partner` by email, set `partner_id`). Decide in Odoo.
2. **Confirmation mails queue as `outgoing`.** Confirm that the attendee1-3 inboxes received "Your registration at Patron Journey Test Festival" with the ticket. If they stay queued, check Odoo's outgoing mail server / mail queue.
3. **Draft (unconfirmed) registrations** are checked in by our scanner (per spec), whereas Odoo's own desk refuses them. Free tickets never produce drafts today; revisit if paid tickets are added.
4. The website registration success page (`/registration/success`) was fetched after each 303 but its wording was not asserted; registrations were verified in Odoo instead.
5. Optional: enable **Use Event Barcode** in Event settings if you also want the 1D barcode printed on badges (QR is always present).
