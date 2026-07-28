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
        rows.append((game, recency * patch_weight * continuity, age))

    def metric(key):
        return weighted([(game[key], weight) for game, weight, _ in rows])

    def kda(game):
        return None if not game["deaths"] else (game["kills"] + game["assists"]) / game["deaths"]

    recent = [game for game, _, age in rows if age <= 45]
    player_rows = [player for game in games for player in game["player_rows"] if player["name"] in lineup]
    player_kda = weighted([((player["kills"] + player["assists"]) / player["deaths"] if player["deaths"] else None, max(0.1, 0.5 ** (max(0, (now - player["date"]).total_seconds() / 86400) / 45))) for player in player_rows])
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
        "roster_kda": player_kda, "patch_win": patch_win, "fb": metric("fb"), "ft": metric("ft"),
        "objectives": (metric("dragons") or 0) + (metric("barons") or 0), "vision": metric("vision"), "side": side_rate,
        "effective": sum(weight for _, weight, _ in rows), "roster_games": len(player_rows), "patch_games": len(patch_players),
    }


def predict(left, right):
    factors = [
        (edge(left["win"], right["win"], .2), .18), (edge(left["recent"], right["recent"], .25), .12),
        (edge(left["gd"], right["gd"], 1200), .14), (edge(left["xp"], right["xp"], 1000), .09),
        (edge(left["cs"], right["cs"], 20), .05), (edge(left["continuity"], right["continuity"], .45), .08),
        (edge(left["roster_kda"], right["roster_kda"], 1.5), .08), (edge(left["patch_win"], right["patch_win"], .25), .08),
        (edge(left["fb"], right["fb"], .2), .04), (edge(left["ft"], right["ft"], .2), .04),
        (edge(left["objectives"], right["objectives"], 1), .05), (edge(left["vision"], right["vision"], .8), .03), (edge(left["side"], right["side"], .25), .02),
    ]
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
  SELECT m.id,m.played_at,m.patch,s.team_id,s.side,s.won,s.kills,s.deaths,s.assists,
    s.gold_diff_15 gd,s.xp_diff_15 xp,s.cs_diff_15 cs,s.first_blood fb,s.first_tower ft,
    s.dragons,s.barons,s.vision_score_per_minute vision
  FROM matches m JOIN team_game_stats s ON s.match_id=m.id
  WHERE m.id IN (SELECT id FROM matches WHERE source_game_id LIKE 'oracle:%' AND played_at>='2022-01-01' ORDER BY played_at DESC,id DESC LIMIT 1600)
  ORDER BY m.played_at,m.id
""").fetchall()
players = defaultdict(list)
for row in db.execute("""
  SELECT p.match_id,p.team_id,p.player_name,p.kills,p.deaths,p.assists,m.played_at,m.patch,s.won
  FROM player_game_stats p JOIN matches m ON m.id=p.match_id
  JOIN team_game_stats s ON s.match_id=p.match_id AND s.team_id=p.team_id
  WHERE m.id IN (SELECT id FROM matches WHERE source_game_id LIKE 'oracle:%' AND played_at>='2022-01-01' ORDER BY played_at DESC,id DESC LIMIT 1600)
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
            predictions.append((chance, left_game["won"], left_game["date"].date().isoformat()))
    history[left_game["team_id"]].append(left_game)
    history[right_game["team_id"]].append(right_game)
    if len(history[left_game["team_id"]]) > 120:
        history[left_game["team_id"]].pop(0)
    if len(history[right_game["team_id"]]) > 120:
        history[right_game["team_id"]].pop(0)

sample = predictions[-200:]
accuracy = sum((chance >= .5) == bool(won) for chance, won, _ in sample) / len(sample)
brier = sum((chance - won) ** 2 for chance, won, _ in sample) / len(sample)
mae = sum(abs(chance - won) for chance, won, _ in sample) / len(sample)
result = {"tested_games": len(sample), "first_game": sample[0][2], "last_game": sample[-1][2], "winner_accuracy_percent": round(accuracy * 100, 1), "brier_score": round(brier, 4), "mean_absolute_error": round(mae, 4)}
print(result)
with open(database_path + ".result.json", "w", encoding="utf-8") as output:
    json.dump(result, output)
