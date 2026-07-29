import datetime as dt
import json
import math
import os
import sqlite3
import sys
from collections import defaultdict


def parse_date(value):
    if not value:
        return None
    value = value.replace("Z", "+00:00").replace(" ", "T")
    try:
        parsed = dt.datetime.fromisoformat(value)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def weighted(values):
    usable = [(value, weight) for value, weight in values if value is not None and weight > 0]
    return sum(value * weight for value, weight in usable) / sum(weight for _, weight in usable) if usable else None


def edge(left, right, scale):
    if left is None or right is None:
        return None
    return max(-1, min(1, (left - right) / scale))


strength_mode = os.environ.get("TOURNAMENT_STRENGTH", "off")


def tournament_strength(stage):
    name = (stage or "").upper()
    base = 1.08 if any(token in name for token in ("WORLDS", "MSI", "MID-SEASON", "EWC", "ESPORTS WORLD CUP")) else 0.92 if any(token in name for token in ("LCKC", "NACL", "ACADEMY", "CHALLENGERS", "LRS", "LIT")) else 1.0 if any(token in name for token in ("LCK", "LPL", "LEC", "LTA", "LCS", "LCP", "PCS", "CBLOL", "VCS", "LJL", "TCL", "LAS", "LLA")) else 0.96
    blend = {"off": 0, "light": .15, "soft": .5, "full": 1}.get(strength_mode, 0)
    return 1 + (base - 1) * blend


def profile(games, lineup, patch, now):
    # Older games have a tiny live-model weight; cap retained history so the
    # replay remains practical while preserving the meaningful recent sample.
    games = games[-100:]
    roster_size = len(lineup)
    rows = []
    for game in games:
        age = max(0, (now - game["date"]).total_seconds() / 86400)
        recency = max(0.08, 0.5 ** (age / 60))
        patch_weight = 1 if patch and game["patch"] == patch else 0.7 if age <= 45 else 0.35 if age <= 120 else 0.15
        overlap = len(lineup & game["players"])
        continuity = 0.35 + 0.65 * min(1, overlap / roster_size) if roster_size else 0.7
        rows.append((game, recency * patch_weight * continuity * tournament_strength(game.get("stage")), age))

    def metric(key):
        return weighted([(game[key], weight) for game, weight, _ in rows])

    def schedule_metric():
        return weighted([(game.get("result_vs_expected"), weight) for game, weight, _ in rows])

    def kda(game):
        return None if not game["deaths"] else (game["kills"] + game["assists"]) / game["deaths"]

    recent = [game for game, _, age in rows if age <= 45]
    player_rows = [player for game in games for player in game["player_rows"] if player["name"] in lineup]
    player_kda = weighted([((player["kills"] + player["assists"]) / player["deaths"] if player["deaths"] else None, max(0.1, 0.5 ** (max(0, (now - player["date"]).total_seconds() / 86400) / 45))) for player in player_rows])
    lineup_win = weighted([(player["won"], max(0.1, 0.5 ** (max(0, (now - player["date"]).total_seconds() / 86400) / 45))) for player in player_rows])
    patch_players = [player for player in player_rows if patch and player["patch"] == patch]
    patch_win = weighted([(player["won"], max(0.1, 0.5 ** (max(0, (now - player["date"]).total_seconds() / 86400) / 45))) for player in patch_players])
    sides = []
    for side in ("blue", "red"):
        sides.append(weighted([(game["won"], weight) for game, weight, _ in rows if game["side"] == side]))
    side_rate = sum(sides) / 2 if all(value is not None for value in sides) else None
    continuity = weighted([(min(1, len(lineup & game["players"]) / roster_size) if roster_size else None, weight) for game, weight, _ in rows])
    return {
        "win": metric("won"), "recent": sum(game["won"] for game in recent) / len(recent) if recent else None,
        "gd": metric("gd"), "xp": metric("xp"), "cs": metric("cs"), "continuity": continuity,
        "roster_kda": player_kda, "lineup_win": lineup_win, "schedule_form": schedule_metric(), "patch_win": patch_win, "fb": metric("fb"), "ft": metric("ft"),
        "objectives": (metric("dragons") or 0) + (metric("barons") or 0), "vision": metric("vision"), "side": side_rate,
        "effective": sum(weight for _, weight, _ in rows), "roster_games": len(player_rows), "patch_games": len(patch_players),
    }


def predict(left, right, lineup_weight=0, schedule_weight=0):
    factors = [
        (edge(left["win"], right["win"], .2), .18), (edge(left["recent"], right["recent"], .25), .12),
        (edge(left["gd"], right["gd"], 1200), .14), (edge(left["xp"], right["xp"], 1000), .09),
        (edge(left["cs"], right["cs"], 20), .05), (edge(left["continuity"], right["continuity"], .45), .08),
        (edge(left["roster_kda"], right["roster_kda"], 1.5), .08), (edge(left["patch_win"], right["patch_win"], .25), .08),
        (edge(left["fb"], right["fb"], .2), .04), (edge(left["ft"], right["ft"], .2), .04),
        (edge(left["objectives"], right["objectives"], 1), .05), (edge(left["vision"], right["vision"], .8), .03), (edge(left["side"], right["side"], .25), .02),
    ]
    if lineup_weight:
        # Candidate only: the starting five's rolling win record. This is
        # evaluated against actual historical starters before going live.
        factors.append((edge(left["lineup_win"], right["lineup_win"], .25), lineup_weight))
    if schedule_weight:
        # Results above/below the Elo expectation: beating strong opposition
        # receives credit while weak-opponent wins are discounted.
        factors.append((edge(left["schedule_form"], right["schedule_form"], .18), schedule_weight))
    available = [(value, weight) for value, weight in factors if value is not None]
    if not available:
        return None
    active = sum(weight for _, weight in available)
    raw = sum(value * weight / active for value, weight in available)
    sample = min(1, min(left["effective"], right["effective"]) / 25)
    roster = min(1, min(left["roster_games"], right["roster_games"]) / 25)
    patch = min(1, min(left["patch_games"], right["patch_games"]) / 15)
    confidence = min(1, active * sample * (.7 + .2 * roster + .1 * patch))
    return 1 / (1 + math.exp(-(raw * 2.1 * max(.4, confidence))))


if len(sys.argv) != 2:
    raise SystemExit("Usage: python scripts/backtest-lol.py <d1-export.sql>")

database_path = sys.argv[1] + ".sqlite"
database_exists = os.path.exists(database_path)
db = sqlite3.connect(database_path)
db.execute("PRAGMA journal_mode=OFF")
db.execute("PRAGMA synchronous=OFF")
if not database_exists:
    with open(sys.argv[1], "r", encoding="utf-8") as source:
        db.executescript(source.read())
db.row_factory = sqlite3.Row
game_rows = db.execute("""
  SELECT m.id,m.played_at,m.stage,m.patch,s.team_id,s.side,s.won,s.kills,s.deaths,s.assists,
    s.gold_diff_15 gd,s.xp_diff_15 xp,s.cs_diff_15 cs,s.first_blood fb,s.first_tower ft,
    s.dragons,s.barons,s.vision_score_per_minute vision
  FROM matches m JOIN team_game_stats s ON s.match_id=m.id
  WHERE m.id IN (SELECT id FROM matches WHERE source_game_id LIKE 'oracle:%' AND played_at>='2022-01-01' ORDER BY played_at DESC,id DESC LIMIT 10000)
  ORDER BY m.played_at,m.id
""").fetchall()
players = defaultdict(list)
for row in db.execute("""
  SELECT p.match_id,p.team_id,p.player_name,p.kills,p.deaths,p.assists,m.played_at,m.patch,s.won
  FROM player_game_stats p JOIN matches m ON m.id=p.match_id
  JOIN team_game_stats s ON s.match_id=p.match_id AND s.team_id=p.team_id
  WHERE m.id IN (SELECT id FROM matches WHERE source_game_id LIKE 'oracle:%' AND played_at>='2022-01-01' ORDER BY played_at DESC,id DESC LIMIT 10000)
"""):
    players[(row["match_id"], row["team_id"])].append(dict(name=row["player_name"], kills=row["kills"], deaths=row["deaths"], assists=row["assists"], date=parse_date(row["played_at"]), patch=row["patch"], won=row["won"]))

matches = defaultdict(list)
for row in game_rows:
    date = parse_date(row["played_at"])
    if not date:
        continue
    entry = dict(row)
    entry["date"] = date
    entry["players"] = {player["name"] for player in players[(row["id"], row["team_id"])]}
    entry["player_rows"] = players[(row["id"], row["team_id"])]
    matches[row["id"]].append(entry)

# Opponent-adjusted Elo is built from the entire imported history, separately
# from the rolling feature window used by the main model.
elo_matches = defaultdict(list)
for row in db.execute("""
  SELECT m.id,m.played_at,s.team_id,s.won
  FROM matches m JOIN team_game_stats s ON s.match_id=m.id
  WHERE m.source_game_id LIKE 'oracle:%' AND m.played_at>='2022-01-01'
  ORDER BY m.played_at,m.id
"""):
    date = parse_date(row["played_at"])
    if date:
        elo_matches[row["id"]].append((row["team_id"], row["won"], date))

ratings, last_seen, elo_before = defaultdict(lambda: 1500.0), {}, {}
for match_id, teams in sorted(elo_matches.items(), key=lambda item: item[1][0][2]):
    if len(teams) != 2:
        continue
    (team_a, won_a, date), (team_b, won_b, _) = teams
    for team in (team_a, team_b):
        if team in last_seen:
            days = max(0, (date - last_seen[team]).total_seconds() / 86400)
            ratings[team] = 1500 + (ratings[team] - 1500) * (0.5 ** (days / 180))
        last_seen[team] = date
    rating_a, rating_b = ratings[team_a], ratings[team_b]
    expected_a = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
    elo_before[match_id] = {team_a: (rating_a, rating_b), team_b: (rating_b, rating_a)}
    ratings[team_a] += 24 * (won_a - expected_a)
    ratings[team_b] += 24 * (won_b - (1 - expected_a))

for match_id, teams in matches.items():
    for game in teams:
        rating, opponent = elo_before.get(match_id, {}).get(game["team_id"], (1500, 1500))
        expected = 1 / (1 + 10 ** ((opponent - rating) / 400))
        game["result_vs_expected"] = game["won"] - expected

history = defaultdict(list)
predictions = []
for _, teams in sorted(matches.items(), key=lambda item: item[1][0]["date"]):
    if len(teams) != 2:
        continue
    left_game, right_game = teams
    left = profile(history[left_game["team_id"]], left_game["players"], left_game["patch"], left_game["date"])
    right = profile(history[right_game["team_id"]], right_game["players"], right_game["patch"], right_game["date"])
    if len(history[left_game["team_id"]]) >= 10 and len(history[right_game["team_id"]]) >= 10:
        chance = predict(left, right)
        if chance is not None:
            rating_a, rating_b = elo_before.get(left_game["id"], {}).get(left_game["team_id"], (1500, 1500))
            elo_chance = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
            trials = {f"lineup_{weight}": predict(left, right, lineup_weight=weight) for weight in (.02, .04, .06, .08)}
            trials.update({f"schedule_{weight}": predict(left, right, schedule_weight=weight) for weight in (.02, .04, .06, .08)})
            predictions.append((chance, elo_chance, left_game["won"], left_game["date"].date().isoformat(), trials))
    history[left_game["team_id"]].append(left_game)
    history[right_game["team_id"]].append(right_game)
    if len(history[left_game["team_id"]]) > 120:
        history[left_game["team_id"]].pop(0)
    if len(history[right_game["team_id"]]) > 120:
        history[right_game["team_id"]].pop(0)

requested_sample = os.environ.get("BACKTEST_SAMPLE", "200")
sample = predictions if requested_sample == "all" else predictions[-max(1, int(requested_sample)):]
accuracy = sum((chance >= .5) == bool(won) for chance, _, won, _, _ in sample) / len(sample)
brier = sum((chance - won) ** 2 for chance, _, won, _, _ in sample) / len(sample)
mae = sum(abs(chance - won) for chance, _, won, _, _ in sample) / len(sample)
blends = {}
for weight in (.1, .2, .3, .4, .5):
    blended = [(1 - weight) * chance + weight * elo for chance, elo, _, _, _ in sample]
    blends[str(weight)] = round(sum((chance >= .5) == bool(won) for chance, (_, _, won, _, _) in zip(blended, sample)) * 100 / len(sample), 1)
lineup_trial_blends = {}
for lineup_weight in (.02, .04, .06, .08):
    for elo_weight in (.3, .4):
        blended = [(1 - elo_weight) * trials[f"lineup_{lineup_weight}"] + elo_weight * elo for _, elo, _, _, trials in sample]
        lineup_trial_blends[f"lineup_{lineup_weight}_elo_{elo_weight}"] = round(sum((chance >= .5) == bool(won) for chance, (_, _, won, _, _) in zip(blended, sample)) * 100 / len(sample), 1)
schedule_trial_blends = {}
for schedule_weight in (.02, .04, .06, .08):
    for elo_weight in (.3, .4):
        blended = [(1 - elo_weight) * trials[f"schedule_{schedule_weight}"] + elo_weight * elo for _, elo, _, _, trials in sample]
        schedule_trial_blends[f"schedule_{schedule_weight}_elo_{elo_weight}"] = round(sum((chance >= .5) == bool(won) for chance, (_, _, won, _, _) in zip(blended, sample)) * 100 / len(sample), 1)
elo_accuracy = sum((chance >= .5) == bool(won) for _, chance, won, _, _ in sample) * 100 / len(sample)
result = {"tested_games": len(sample), "first_game": sample[0][3], "last_game": sample[-1][3], "winner_accuracy_percent": round(accuracy * 100, 1), "elo_accuracy_percent": round(elo_accuracy, 1), "blended_accuracy_percent": blends, "confirmed_lineup_trial_percent": lineup_trial_blends, "strength_of_schedule_trial_percent": schedule_trial_blends, "brier_score": round(brier, 4), "mean_absolute_error": round(mae, 4)}
print(result)
with open(database_path + ".result.json", "w", encoding="utf-8") as output:
    json.dump(result, output)
