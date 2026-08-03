CREATE TABLE IF NOT EXISTS site_visual_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS managed_leagues (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  region TEXT,
  tier TEXT,
  logo_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS managed_pro_teams (
  id INTEGER PRIMARY KEY,
  league_id INTEGER REFERENCES managed_leagues(id) ON DELETE SET NULL,
  name TEXT NOT NULL UNIQUE,
  short_name TEXT,
  region TEXT,
  logo_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS managed_pro_players (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL UNIQUE,
  real_name TEXT,
  role TEXT,
  country TEXT,
  photo_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS managed_team_memberships (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES managed_pro_teams(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES managed_pro_players(id) ON DELETE CASCADE,
  role TEXT,
  status TEXT NOT NULL DEFAULT 'starter',
  starts_at TEXT,
  ends_at TEXT,
  UNIQUE(team_id, player_id, starts_at)
);

CREATE TABLE IF NOT EXISTS managed_player_accounts (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES managed_pro_players(id) ON DELETE CASCADE,
  game_name TEXT NOT NULL,
  tag_line TEXT NOT NULL,
  region TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'primary',
  confidence TEXT NOT NULL DEFAULT 'confirmed',
  source_url TEXT,
  last_checked_at TEXT,
  last_error TEXT,
  UNIQUE(player_id, game_name, tag_line, region)
);

CREATE INDEX IF NOT EXISTS managed_pro_teams_league_idx ON managed_pro_teams(league_id);
CREATE INDEX IF NOT EXISTS managed_team_memberships_team_idx ON managed_team_memberships(team_id);
CREATE INDEX IF NOT EXISTS managed_player_accounts_player_idx ON managed_player_accounts(player_id);
