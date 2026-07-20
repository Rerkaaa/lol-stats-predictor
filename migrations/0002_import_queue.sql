CREATE TABLE IF NOT EXISTS import_jobs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('season', 'tournament', 'series', 'game')),
  source_key TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  tournament_id INTEGER REFERENCES tournaments(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'complete', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS import_jobs_status_idx ON import_jobs(status, id);
