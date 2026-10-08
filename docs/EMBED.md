# Embedding the organizer dashboard on pjrny.com

Deployed in `0.3.1-embed`. All HTML pages (`/`, `/dashboard`, `/dashboard/checkin`, `/auth/magic`) send:

```
Content-Security-Policy: frame-ancestors 'self' https://pjrny.com https://*.pjrny.com https://patronjourney.com https://*.patronjourney.com https://patronjourney.odoo.com
Permissions-Policy: camera=(self)
```

`X-Frame-Options` is no longer sent (it cannot express an allow-list; CSP `frame-ancestors` replaces it).
patronjourney.com / patronjourney.odoo.com are allowed because the Odoo website editor previews pages inside a
backend iframe and `frame-ancestors` is checked against every ancestor. To allow another site, edit
`FRAME_ANCESTORS` in `src/http.ts`.

## Session cookie

`pj_session=...; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=43200`

`SameSite=None` lets the cookie work inside the cross-site iframe (pjrny.com -> workers.dev). CSRF protection:
- cookie-authenticated writes on `/api/organizer/*` require `Origin` == the Worker origin (unchanged);
- POSTs to `/api/auth/*` from any other browser origin get 403 (login/logout CSRF);
- `/auth/magic` POST needs a one-time token, so it stays a plain form.

Browsers that block third-party cookies (Safari, strict modes): PIN login also stores the returned JWT in the
iframe's `sessionStorage` and the dashboard sends it as `Authorization: Bearer`. Magic links open in a new
top-level tab, so in those browsers the embedded panel won't see that login; the dashboard shows a note when framed
(use PIN in the frame, or open the dashboard in a new tab).

No CORS is needed: the iframe's pages call the API on their own origin.

## Snippet for an Odoo HTML / Embed Code block (www.pjrny.com/organizers)

```html
<iframe
  src="https://events-patronjourney.message-0ad.workers.dev/dashboard"
  title="Patron Journey Organizer Dashboard"
  style="width:100%;min-height:1400px;border:0;border-radius:8px;"
  allow="camera; clipboard-write"
  referrerpolicy="no-referrer"
></iframe>
```

`allow="camera"` is required for the check-in scanner when it is opened inside the iframe.
