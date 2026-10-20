-- Will It Rain On My Event? (/weather)
-- Geocode cache for Nominatim (keyed by normalized address). Never expires; addresses rarely move.
CREATE TABLE IF NOT EXISTS geocode_cache (
  q            TEXT PRIMARY KEY,                     -- lower-cased, whitespace-collapsed address
  lat          REAL NOT NULL,
  lon          REAL NOT NULL,
  display_name TEXT,
  city         TEXT,
  state        TEXT,
  country_code TEXT,                                 -- ISO 3166-1 alpha-2, upper case
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Single-row throttle so the whole Worker stays at <= 1 Nominatim request per second.
CREATE TABLE IF NOT EXISTS nominatim_throttle (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  last_ms INTEGER NOT NULL
);
-- Full risk responses: 24h response cache (by cache_key) AND permanent share permalinks (by id).
CREATE TABLE IF NOT EXISTS weather_results (
  id          TEXT PRIMARY KEY,                      -- wx_... permalink id
  cache_key   TEXT NOT NULL,                         -- q|date|days
  payload     TEXT NOT NULL,                         -- weather-risk.v1 JSON
  ip_hash     TEXT,                                  -- SHA-256 of client IP (rate limiting only)
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_weather_cache ON weather_results (cache_key, created_at);
CREATE INDEX IF NOT EXISTS idx_weather_ip ON weather_results (ip_hash, created_at);
