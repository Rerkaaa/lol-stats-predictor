CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY,
  gol_slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  season TEXT,
  region TEXT,
  games_count INTEGER,
  first_game_date TEXT,
  last_game_date TEXT,
  source_url TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  gol_id INTEGER UNIQUE,
  name TEXT NOT NULL,
  region TEXT,
  source_url TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  gol_game_id INTEGER NOT NULL UNIQUE,
  tournament_id INTEGER REFERENCES tournaments(id),
  played_at TEXT,
  patch TEXT,
  stage TEXT,
  blue_team_id INTEGER REFERENCES teams(id),
  red_team_id INTEGER REFERENCES teams(id),
  winner_team_id INTEGER REFERENCES teams(id),
  duration_seconds INTEGER,
  blue_kills INTEGER,
  red_kills INTEGER,
  source_url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_game_stats (
  match_id INTEGER NOT NULL REFERENCES matches(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  side TEXT NOT NULL CHECK(side IN ('blue','red')),
  won INTEGER NOT NULL CHECK(won IN (0,1)),
  kills INTEGER, deaths INTEGER, assists INTEGER,
  gold INTEGER, gold_per_minute REAL, gold_diff_15 INTEGER,
  xp_diff_15 INTEGER, cs_diff_15 REAL,
  first_blood INTEGER, first_tower INTEGER,
  dragons INTEGER, barons INTEGER, heralds INTEGER,
  towers INTEGER, vision_score_per_minute REAL,
  draft_score REAL DEFAULT 0,
  PRIMARY KEY (match_id, team_id)
);

CREATE TABLE IF NOT EXISTS player_game_stats (
  match_id INTEGER NOT NULL REFERENCES matches(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  player_name TEXT NOT NULL,
  role TEXT,
  champion TEXT,
  kills INTEGER, deaths INTEGER, assists INTEGER,
  cs INTEGER, gold INTEGER, damage INTEGER,
  vision_score INTEGER,
  PRIMARY KEY (match_id, team_id, player_name)
);

CREATE TABLE IF NOT EXISTS drafts (
  match_id INTEGER NOT NULL REFERENCES matches(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  phase TEXT NOT NULL CHECK(phase IN ('pick','ban')),
  sequence_no INTEGER NOT NULL,
  champion TEXT NOT NULL,
  PRIMARY KEY (match_id, team_id, phase, sequence_no)
);

CREATE INDEX IF NOT EXISTS matches_tournament_date_idx ON matches(tournament_id, played_at);
CREATE INDEX IF NOT EXISTS team_game_stats_team_idx ON team_game_stats(team_id, match_id);
CREATE INDEX IF NOT EXISTS player_game_stats_player_idx ON player_game_stats(player_name, match_id);
