CREATE TABLE IF NOT EXISTS summoner_rank_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lookup_key TEXT NOT NULL,
  season_year INTEGER NOT NULL,
  tier TEXT,
  division TEXT,
  league_points INTEGER,
  wins INTEGER,
  losses INTEGER,
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS summoner_rank_snapshots_lookup_idx
  ON summoner_rank_snapshots(lookup_key, season_year, captured_at DESC);
