-- Patron Journey Organizer Platform - D1 schema v1
-- D1 holds ownership, sessions and audit only. Events, tickets, registrations,
-- attendees, venues, tracks, booths and sponsors live in Odoo (source of truth).

CREATE TABLE IF NOT EXISTS organizers (
  id               INTEGER PRIMARY KEY,
  email            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  odoo_partner_id  INTEGER,                         -- res.partner id of the organizer contact
  odoo_user_id     INTEGER,                         -- res.users id of the portal user (optional)
  display_name     TEXT,
  pin_hash         TEXT,                            -- PBKDF2-SHA256 "pbkdf2$iter$salt$hash"; NULL = PIN login disabled
  role             TEXT    NOT NULL DEFAULT 'organizer' CHECK (role IN ('organizer','admin')),
  tier             TEXT    NOT NULL DEFAULT 'free'      CHECK (tier IN ('free','paid')),
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- THE ownership table. Every event-scoped request is authorized against it.
CREATE TABLE IF NOT EXISTS organizer_events (
  id             INTEGER PRIMARY KEY,
  organizer_id   INTEGER NOT NULL REFERENCES organizers(id),
  odoo_event_id  INTEGER NOT NULL,                  -- event.event id
  website_id     INTEGER,                           -- website id (Patron Journey or pjrny)
  status         TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organizer_id, odoo_event_id)
);
CREATE INDEX IF NOT EXISTS idx_organizer_events_event ON organizer_events (odoo_event_id);

-- Server-side session registry so JWTs can be revoked (JWT carries sid = session_id).
CREATE TABLE IF NOT EXISTS sessions (
  session_id     TEXT PRIMARY KEY,
  organizer_id   INTEGER NOT NULL REFERENCES organizers(id),
  auth_method    TEXT    NOT NULL CHECK (auth_method IN ('magic_link','pin')),
  user_agent     TEXT,
  ip             TEXT,
  expires_at     DATETIME NOT NULL,
  revoked_at     DATETIME,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_organizer ON sessions (organizer_id);

-- One-time magic-link tokens (only the SHA-256 hash is stored).
CREATE TABLE IF NOT EXISTS magic_links (
  token_hash     TEXT PRIMARY KEY,
  organizer_id   INTEGER NOT NULL REFERENCES organizers(id),
  expires_at     DATETIME NOT NULL,
  used_at        DATETIME,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Login throttling for PIN / magic-link requests (kept in D1, not KV, because KV is cache-only).
CREATE TABLE IF NOT EXISTS login_attempts (
  id             INTEGER PRIMARY KEY,
  email          TEXT    NOT NULL COLLATE NOCASE,
  method         TEXT    NOT NULL,
  ip             TEXT,
  success        INTEGER NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts (email, created_at);

-- Every mutating action is logged.
CREATE TABLE IF NOT EXISTS audit_logs (
  id             INTEGER PRIMARY KEY,
  organizer_id   INTEGER,                           -- NULL for system/admin actions
  action         TEXT    NOT NULL,                  -- e.g. event.created, venue.added, checkin.performed
  odoo_model     TEXT,
  odoo_id        INTEGER,
  odoo_event_id  INTEGER,
  detail         TEXT,                              -- JSON, never contains secrets
  ip             TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs (odoo_event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_organizer ON audit_logs (organizer_id, created_at);
