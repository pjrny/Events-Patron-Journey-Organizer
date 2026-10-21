-- Festival directory (Oscar's listing data, ~26.8k rows) for /weather competition, /api/festivals,
-- the competitor-analysis page and simulator. No personal emails/phones are stored.
CREATE TABLE IF NOT EXISTS festival_directory (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  city          TEXT,
  state         TEXT,
  country       TEXT,                 -- ISO 3166-1 alpha-2
  lat           REAL,                 -- city centroid (GeoNames), not venue
  lon           REAL,
  geo_precision TEXT,                 -- 'city' | 'city_country' | NULL
  month         INTEGER,              -- 1-12 from start_date
  start_date    TEXT,                 -- as listed (mostly 2018 editions)
  end_date      TEXT,
  category      TEXT,                 -- type: Music, Food, Art, ...
  subcategory   TEXT,                 -- genre
  attendance    INTEGER,
  website       TEXT,                 -- domain derived from organization email domain (no addresses kept)
  socials       TEXT,                 -- JSON, reserved
  source        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fd_country_city_month ON festival_directory (country, city COLLATE NOCASE, month);
CREATE INDEX IF NOT EXISTS idx_fd_lat_lon ON festival_directory (lat, lon);
CREATE INDEX IF NOT EXISTS idx_fd_month ON festival_directory (month);
-- Fixed-window per-IP rate limit for public /api/festivals.
CREATE TABLE IF NOT EXISTS api_rate (
  k      TEXT PRIMARY KEY,               -- route|ip_hash|window
  n      INTEGER NOT NULL,
  exp_ms INTEGER NOT NULL
);
