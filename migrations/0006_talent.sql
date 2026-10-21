-- Talent Draw Estimator (/talent)
-- Full talent-draw.v1 responses: 7-day response cache (by cache_key) AND permanent share permalinks (by id).
CREATE TABLE IF NOT EXISTS talent_results (
  id          TEXT PRIMARY KEY,                      -- td_... permalink id
  cache_key   TEXT NOT NULL,
  payload     TEXT NOT NULL,                         -- talent-draw.v1 JSON
  ip_hash     TEXT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_talent_cache ON talent_results (cache_key, created_at);
-- Per-source, per-artist lookups (7 days), so big lineups fill over a few rounds and repeats are free.
CREATE TABLE IF NOT EXISTS talent_source_cache (
  k           TEXT PRIMARY KEY,                      -- source|artist[|city]
  payload     TEXT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Single-row throttle: whole Worker stays at <= 1 MusicBrainz request per second.
CREATE TABLE IF NOT EXISTS musicbrainz_throttle (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  last_ms INTEGER NOT NULL
);
