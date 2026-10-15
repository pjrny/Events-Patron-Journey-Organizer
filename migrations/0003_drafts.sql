-- Simulator link: event drafts (event-draft.v1) posted by the Festival Forecaster.
-- Anonymous drafts carry a one-time claim token (only its SHA-256 is stored) and expire after 7 days.
-- Claimed / signed-in drafts belong to an organizer and do not expire.
CREATE TABLE IF NOT EXISTS drafts (
  id                TEXT PRIMARY KEY,                -- random url-safe id
  organizer_id      INTEGER REFERENCES organizers(id), -- NULL until claimed
  claim_token_hash  TEXT,                            -- SHA-256 of the claim token (anonymous drafts only)
  payload           TEXT    NOT NULL,                -- validated event-draft.v1 JSON (incl. opaque forecast)
  ip_hash           TEXT,                            -- SHA-256 of client IP, for per-IP rate limiting only
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at        DATETIME,                        -- created_at + 7 days for anonymous; NULL once owned
  claimed_at        DATETIME,
  created_event_id  INTEGER                          -- Odoo event.event id once created (-1 = create in progress)
);
CREATE INDEX IF NOT EXISTS idx_drafts_organizer ON drafts (organizer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_drafts_ip ON drafts (ip_hash, created_at);

-- Carries a pending draft claim through the email sign-in link (magic_links OR signup_links row,
-- joined by the same token_hash). No cookies: the claim token was verified when the link was requested,
-- and the draft is attached to whoever verifies the link.
CREATE TABLE IF NOT EXISTS auth_link_drafts (
  token_hash  TEXT PRIMARY KEY,                      -- = magic_links.token_hash or signup_links.token_hash
  draft_id    TEXT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
