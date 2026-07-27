CREATE TABLE IF NOT EXISTS valorant_teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS valorant_series (
  id INTEGER PRIMARY KEY,
  source_match_id TEXT NOT NULL UNIQUE,
  source_url TEXT,
  event_name TEXT,
  event_tier TEXT,
  played_at TEXT NOT NULL,
  best_of INTEGER,
  patch TEXT,
  team_a_id INTEGER NOT NULL REFERENCES valorant_teams(id),
  team_b_id INTEGER NOT NULL REFERENCES valorant_teams(id),
  team_a_score INTEGER,
  team_b_score INTEGER,
  winner_team_id INTEGER REFERENCES valorant_teams(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS valorant_series_played_at ON valorant_series(played_at DESC);

CREATE TABLE IF NOT EXISTS valorant_maps (
  id INTEGER PRIMARY KEY,
  series_id INTEGER NOT NULL REFERENCES valorant_series(id) ON DELETE CASCADE,
  map_number INTEGER NOT NULL,
  map_name TEXT NOT NULL,
  duration_seconds INTEGER,
  team_a_score INTEGER,
  team_b_score INTEGER,
  winner_team_id INTEGER REFERENCES valorant_teams(id),
  UNIQUE(series_id, map_number)
);
CREATE INDEX IF NOT EXISTS valorant_maps_series ON valorant_maps(series_id);

CREATE TABLE IF NOT EXISTS valorant_player_maps (
  id INTEGER PRIMARY KEY,
  map_id INTEGER NOT NULL REFERENCES valorant_maps(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES valorant_teams(id),
  player_name TEXT NOT NULL,
  agent TEXT,
  rating REAL,
  acs REAL,
  adr REAL,
  kills INTEGER,
  deaths INTEGER,
  assists INTEGER,
  headshot_percent REAL,
  first_kills INTEGER,
  first_deaths INTEGER,
  UNIQUE(map_id, team_id, player_name)
);
CREATE INDEX IF NOT EXISTS valorant_player_maps_team ON valorant_player_maps(team_id, player_name);
