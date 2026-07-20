CREATE TABLE IF NOT EXISTS game_metrics (
  match_id INTEGER NOT NULL REFERENCES matches(id),
  team_id INTEGER REFERENCES teams(id),
  player_name TEXT,
  metric TEXT NOT NULL,
  numeric_value REAL,
  text_value TEXT,
  source TEXT NOT NULL DEFAULT 'gol.gg',
  PRIMARY KEY (match_id, team_id, player_name, metric)
);
CREATE INDEX IF NOT EXISTS game_metrics_metric_idx ON game_metrics(metric, match_id);
