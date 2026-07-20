ALTER TABLE matches ADD COLUMN source_game_id TEXT;
ALTER TABLE teams ADD COLUMN source_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS matches_source_game_idx ON matches(source_game_id);
CREATE UNIQUE INDEX IF NOT EXISTS teams_source_key_idx ON teams(source_key);
