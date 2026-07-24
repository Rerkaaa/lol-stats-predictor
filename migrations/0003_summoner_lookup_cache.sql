CREATE TABLE IF NOT EXISTS summoner_lookup_cache (
  lookup_key TEXT PRIMARY KEY,
  region TEXT NOT NULL,
  game_name TEXT NOT NULL,
  tag_line TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS summoner_lookup_cache_updated_idx ON summoner_lookup_cache(updated_at DESC);
