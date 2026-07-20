CREATE TABLE IF NOT EXISTS oracle_import_runs (
  id INTEGER PRIMARY KEY,
  source_year INTEGER NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','complete','failed')),
  rows_received INTEGER NOT NULL DEFAULT 0,
  rows_rejected INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
