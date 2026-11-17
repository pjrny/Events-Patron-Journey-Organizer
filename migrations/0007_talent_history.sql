-- Organizer-owned historic show data for the Talent Draw Estimator and Festival Simulator.
-- Private to the signed-in organizer; feeds the "past draw" signal (weight .30) and the artist pay estimate.
CREATE TABLE IF NOT EXISTS talent_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  organizer_id  INTEGER NOT NULL,
  artist        TEXT NOT NULL,
  artist_norm   TEXT NOT NULL,
  city          TEXT,
  show_date     TEXT,
  venue         TEXT,
  capacity      INTEGER,
  tickets_sold  INTEGER,
  gross         REAL,
  fee_paid      REAL,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_talent_history_org ON talent_history (organizer_id, artist_norm);
