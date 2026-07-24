CREATE TABLE IF NOT EXISTS riot_match_detail_cache (
  match_id TEXT PRIMARY KEY,
  region TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
