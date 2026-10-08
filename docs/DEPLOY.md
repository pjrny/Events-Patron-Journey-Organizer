# Deploy notes

## Target
- Account: `0adfeaaccd1d2cfa389d7bcd33b55ee4` (Message@pjrny.com)
- Worker service: `events-patronjourney` (already exists; its secrets stay bound across deploys)
- Hosting: `workers.dev` only (`workers_dev: true`, no routes). `patronjourney.com` / `pjrny.com` stay on Odoo.

## Important
- Deploying replaces whatever code the dashboard Worker runs today. Secrets are kept. Plain vars are kept (`keep_vars: true`), except the ones declared in `wrangler.jsonc`, which win.
- Worker secret values cannot be read back from Cloudflare (dashboard, wrangler, or API). The Odoo probe therefore runs **inside** the deployed Worker, which has the secret bound.

## Ways to deploy (pick one)
1. **Wrangler from a machine that is logged in**: `npx wrangler login` then `npm run deploy`.
2. **GitHub Actions**: create a Cloudflare API token (template "Edit Cloudflare Workers" + D1 Edit), add it as repo secret `CLOUDFLARE_API_TOKEN`, and add `docs/github-actions-deploy.yml.example` as `.github/workflows/deploy.yml`.
3. **Workers Builds (dashboard Git integration)**: Worker → Settings → Builds → connect `pjrny/Events-Patron-Journey-Organizer`, branch `main`, build command `npm ci`, deploy command `npx wrangler deploy`.

## After the first deploy
1. Add secret `ADMIN_TOKEN` (random 32+ chars). Add `JWT_SECRET` and `PIN_PEPPER` too (needed next slice).
2. `GET /health` → expect `ok: true`, `odoo.api_key_bound: true`.
3. `GET /api/admin/diag` with `Authorization: Bearer <ADMIN_TOKEN>` → lists secret NAMES and which one is the Odoo key.
4. `GET /api/admin/odoo/probe` → `api.allowed` true/false, field map, Testival summary.
5. Only if allowed: `POST /api/admin/odoo/probe-write?confirm=yes` → one archived, unpublished "PJ Organizer API Probe" event; reports what `copy` carried over (tickets, tracks, sponsors, booths, mail schedulers).
6. Paste the probe JSON into `docs/odoo-probe-result.json` (it contains no secrets) and update `docs/ODOO_API_MAP.md`.
