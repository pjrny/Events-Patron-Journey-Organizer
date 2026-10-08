-- Self-service organizer onboarding (auto-create on first verified sign-in).
-- A pjrny.com website/portal user who is not yet an organizer gets a one-time sign-in link stored here
-- (keyed by email, not organizer id). The organizers row is only inserted when that link is VERIFIED,
-- so a D1 organizer always corresponds to an email address that (a) has an Odoo res.users account and
-- (b) proved control of the mailbox.
CREATE TABLE IF NOT EXISTS signup_links (
  token_hash       TEXT PRIMARY KEY,                -- SHA-256 of the one-time token
  email            TEXT    NOT NULL COLLATE NOCASE,
  odoo_user_id     INTEGER NOT NULL,                -- res.users id found at request time
  odoo_partner_id  INTEGER,                         -- res.partner id of that user
  display_name     TEXT,
  website_id       INTEGER,                         -- res.users.website_id (2 = pjrny) when set
  expires_at       DATETIME NOT NULL,
  used_at          DATETIME,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_signup_links_email ON signup_links (email, created_at);
