ALTER TABLE oracle_import_runs ADD COLUMN source_hash TEXT;
ALTER TABLE oracle_import_runs ADD COLUMN games_received INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oracle_import_runs ADD COLUMN games_skipped INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS oracle_game_versions (
  source_game_id TEXT PRIMARY KEY,
  source_year INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  source_url TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS oracle_game_versions_year_idx ON oracle_game_versions(source_year, imported_at);
