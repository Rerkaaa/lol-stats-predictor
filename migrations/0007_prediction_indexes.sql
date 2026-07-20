CREATE INDEX IF NOT EXISTS matches_prediction_date_patch_idx ON matches(played_at, patch);
CREATE INDEX IF NOT EXISTS team_game_stats_prediction_idx ON team_game_stats(team_id, match_id, side, won);
CREATE INDEX IF NOT EXISTS player_game_stats_prediction_idx ON player_game_stats(team_id, match_id, player_name, champion);
