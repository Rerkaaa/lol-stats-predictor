CREATE TABLE IF NOT EXISTS leaguepedia_series_games (
  game_id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  game_number INTEGER,
  played_at TEXT,
  competition TEXT,
  team_a TEXT,
  team_b TEXT,
  winner TEXT,
  patch TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS leaguepedia_series_match_idx ON leaguepedia_series_games(match_id, game_number);
CREATE INDEX IF NOT EXISTS leaguepedia_series_date_idx ON leaguepedia_series_games(played_at DESC);
