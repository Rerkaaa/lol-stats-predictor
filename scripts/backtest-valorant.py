import datetime as dt
import json
import math
import os
import sqlite3
import sys
from collections import defaultdict


DAY = 86_400


def parse_date(value):
    if not value:
        return None
    try:
        value = value.replace("Z", "+00:00").replace(" ", "T")
        parsed = dt.datetime.fromisoformat(value)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def average(values):
    usable = [(value, weight) for value, weight in values if value is not None and weight > 0]
    return sum(value * weight for value, weight in usable) / sum(weight for _, weight in usable) if usable else None


def edge(left, right, scale):
    if left is None or right is None:
        return None
    return max(-1, min(1, (left - right) / scale))


def weight_for(date, now):
    age = max(0, (now - date).total_seconds() / DAY)
    return max(.08, .5 ** (age / 45))


def profile(maps, now, confirmed_lineup=None):
    weighted = [(game, weight_for(game["date"], now)) for game in maps]
    metric = lambda key: average([(game[key], weight) for game, weight in weighted])
    recent = [game for game in maps if (now - game["date"]).total_seconds() / DAY <= 35]
    lineup_adr = None
    lineup_kda = None
    if confirmed_lineup:
        selected = [
            (player, weight)
            for game, weight in weighted
            for player in game["players"]
            if player["name"] in confirmed_lineup
        ]
        lineup_adr = average([(player["adr"], weight) for player, weight in selected])
        lineup_kda = average([((player["kills"] + player["assists"]) / max(1, player["deaths"]), weight) for player, weight in selected if player["kills"] is not None and player["deaths"] is not None and player["assists"] is not None])
    return {
        "win": metric("won"),
        "recent": sum(game["won"] for game in recent) / len(recent) if recent else None,
        "round": metric("round_diff"),
        "adr": metric("adr"),
        "lineup_adr": lineup_adr,
        "lineup_kda": lineup_kda,
        "effective": sum(weight for _, weight in weighted),
    }


def probability(left, right, lineup_weight=0, player_form_weight=0):
    factors = [
        (edge(left["win"], right["win"], .20), .44),
        (edge(left["round"], right["round"], 4), .34),
        (edge(left["recent"], right["recent"], .25), .14),
        (edge(left["adr"], right["adr"], 25), .08),
    ]
    if lineup_weight:
        factors.append((edge(left["lineup_adr"], right["lineup_adr"], 25), lineup_weight))
    if player_form_weight:
        factors.append((edge(left["lineup_kda"], right["lineup_kda"], .50), player_form_weight))
    available = [(value, weight) for value, weight in factors if value is not None]
    if not available:
        return None
    active = sum(weight for _, weight in available)
    raw = sum(value * weight / active for value, weight in available)
    coverage = min(1, min(left["effective"], right["effective"]) / 25)
    return 1 / (1 + math.exp(-(raw * .9 * max(.45, coverage))))


def series_chance(map_chance, best_of):
    needed = best_of // 2 + 1
    return sum(math.comb(best_of, wins) * map_chance ** wins * (1 - map_chance) ** (best_of - wins) for wins in range(needed, best_of + 1))


if len(sys.argv) != 2:
    raise SystemExit("Usage: python scripts/backtest-valorant.py <d1-export.sql>")

database_path = sys.argv[1] + ".sqlite"
if not os.path.exists(database_path):
    db = sqlite3.connect(database_path)
    with open(sys.argv[1], "r", encoding="utf-8") as source:
        db.executescript(source.read())
else:
    db = sqlite3.connect(database_path)
db.row_factory = sqlite3.Row

player_rows = defaultdict(list)
for row in db.execute("""
  SELECT p.map_id,p.team_id,p.player_name,p.adr,p.kills,p.deaths,p.assists
  FROM valorant_player_maps p
"""):
    player_rows[(row["map_id"], row["team_id"])].append({"name": row["player_name"], "adr": row["adr"], "kills": row["kills"], "deaths": row["deaths"], "assists": row["assists"]})

series = defaultdict(list)
for row in db.execute("""
  SELECT m.id map_id,m.map_number,s.id series_id,s.played_at,s.best_of,s.team_a_id,s.team_b_id,
         s.team_a_score,s.team_b_score,s.winner_team_id,m.team_a_score,m.team_b_score,m.winner_team_id
  FROM valorant_maps m JOIN valorant_series s ON s.id=m.series_id
  WHERE s.played_at>='2025-01-01' AND s.played_at<'2027-01-01' AND m.winner_team_id IS NOT NULL
  ORDER BY s.played_at,s.id,m.map_number
"""):
    date = parse_date(row["played_at"])
    if not date:
        continue
    for team_id, opponent_id, rounds_for, rounds_against in ((row["team_a_id"], row["team_b_id"], row["team_a_score"], row["team_b_score"]), (row["team_b_id"], row["team_a_id"], row["team_b_score"], row["team_a_score"])):
        series[row["series_id"]].append({
            "series_id": row["series_id"], "map_id": row["map_id"], "map_number": row["map_number"], "date": date,
            "team_id": team_id, "opponent_id": opponent_id, "won": int(row["winner_team_id"] == team_id),
            "round_diff": None if rounds_for is None or rounds_against is None else rounds_for - rounds_against,
            "players": player_rows.get((row["map_id"], team_id), []),
            "adr": average([(player["adr"], 1) for player in player_rows.get((row["map_id"], team_id), [])]),
            "series_winner": row["winner_team_id"],
            "team_a_score": row["team_a_score"], "team_b_score": row["team_b_score"],
        })

# Series-level Elo avoids leaking map-one results into the rating used for the
# same series. It is the Valorant equivalent of opponent-adjusted form.
ratings, last_seen, elo_before = defaultdict(lambda: 1500.0), {}, {}
for series_id, entries in sorted(series.items(), key=lambda item: item[1][0]["date"]):
    first_map = defaultdict(list)
    for entry in entries:
        first_map[entry["map_id"]].append(entry)
    teams = next(iter(first_map.values()), [])
    if len(teams) != 2:
        continue
    left, right = teams
    for team_id in (left["team_id"], right["team_id"]):
        if team_id in last_seen:
            days = max(0, (left["date"] - last_seen[team_id]).total_seconds() / DAY)
            ratings[team_id] = 1500 + (ratings[team_id] - 1500) * (.5 ** (days / 180))
        last_seen[team_id] = left["date"]
    left_rating, right_rating = ratings[left["team_id"]], ratings[right["team_id"]]
    expected = 1 / (1 + 10 ** ((right_rating - left_rating) / 400))
    elo_before[series_id] = expected
    if left["series_winner"] is not None:
        actual = int(left["series_winner"] == left["team_id"])
        ratings[left["team_id"]] += 24 * (actual - expected)
        ratings[right["team_id"]] += 24 * ((1 - actual) - (1 - expected))

history = defaultdict(list)
map_predictions, series_predictions = [], []
elo_map_trials = {weight: [] for weight in (.1, .2, .3, .4, .5)}
elo_series_trials = {weight: [] for weight in (.1, .2, .3, .4, .5)}
lineup_map_trials = {weight: [] for weight in (.02, .04, .06, .08)}
lineup_series_trials = {weight: [] for weight in (.02, .04, .06, .08)}
player_form_map_trials = {weight: [] for weight in (.02, .04, .06)}
player_form_series_trials = {weight: [] for weight in (.02, .04, .06)}
for _, entries in sorted(series.items(), key=lambda item: item[1][0]["date"]):
    by_map = defaultdict(list)
    for entry in entries:
        by_map[entry["map_id"]].append(entry)
    maps = [teams for _, teams in sorted(by_map.items(), key=lambda item: item[1][0]["map_number"])]
    first = maps[0]
    if len(first) != 2:
        continue
    left, right = first
    if len(history[left["team_id"]]) >= 10 and len(history[right["team_id"]]) >= 10:
        left_lineup = {player["name"] for player in left["players"] if player["name"]}
        right_lineup = {player["name"] for player in right["players"] if player["name"]}
        left_profile = profile(history[left["team_id"]], left["date"], left_lineup if len(left_lineup) == 5 else None)
        right_profile = profile(history[right["team_id"]], right["date"], right_lineup if len(right_lineup) == 5 else None)
        chance = probability(left_profile, right_profile)
        if chance is not None:
            elo_chance = elo_before.get(left["series_id"], .5)
            for teams in maps:
                side = next((entry for entry in teams if entry["team_id"] == left["team_id"]), None)
                if side:
                    map_predictions.append((chance, side["won"]))
                    for weight in elo_map_trials:
                        elo_map_trials[weight].append(((1 - weight) * chance + weight * elo_chance, side["won"]))
                    for weight in lineup_map_trials:
                        lineup_chance = probability(left_profile, right_profile, weight)
                        if lineup_chance is not None:
                            # Preserve the live .40 Elo blend while trialling the new factor.
                            lineup_map_trials[weight].append((.6 * lineup_chance + .4 * elo_chance, side["won"]))
                    for weight in player_form_map_trials:
                        player_chance = probability(left_profile, right_profile, .04, weight)
                        if player_chance is not None:
                            player_form_map_trials[weight].append((.6 * player_chance + .4 * elo_chance, side["won"]))
            high_score = max(left["team_a_score"] or 0, left["team_b_score"] or 0)
            best_of = 5 if high_score >= 3 else 3 if high_score >= 2 else 1
            if left["series_winner"] is not None:
                series_predictions.append((series_chance(chance, best_of), int(left["series_winner"] == left["team_id"]), best_of))
                for weight in elo_series_trials:
                    blended = (1 - weight) * chance + weight * elo_chance
                    elo_series_trials[weight].append((series_chance(blended, best_of), int(left["series_winner"] == left["team_id"]), best_of))
                for weight in lineup_series_trials:
                    lineup_chance = probability(left_profile, right_profile, weight)
                    if lineup_chance is not None:
                        blended = .6 * lineup_chance + .4 * elo_chance
                        lineup_series_trials[weight].append((series_chance(blended, best_of), int(left["series_winner"] == left["team_id"]), best_of))
                for weight in player_form_series_trials:
                    player_chance = probability(left_profile, right_profile, .04, weight)
                    if player_chance is not None:
                        blended = .6 * player_chance + .4 * elo_chance
                        player_form_series_trials[weight].append((series_chance(blended, best_of), int(left["series_winner"] == left["team_id"]), best_of))
    for teams in maps:
        for entry in teams:
            history[entry["team_id"]].append(entry)
            if len(history[entry["team_id"]]) > 120:
                history[entry["team_id"]].pop(0)

accuracy = lambda rows: round(sum((chance >= .5) == bool(won) for chance, won, *_ in rows) * 100 / len(rows), 1) if rows else None
result = {
    "tested_maps": len(map_predictions), "map_winner_accuracy_percent": accuracy(map_predictions),
    "tested_series": len(series_predictions), "series_winner_accuracy_percent": accuracy(series_predictions),
    "series_by_format": {str(best_of): {"tested": sum(1 for _, _, fmt in series_predictions if fmt == best_of), "accuracy_percent": accuracy([row for row in series_predictions if row[2] == best_of])} for best_of in (1, 3, 5)},
    "opponent_adjusted_elo_trials": {str(weight): {"map_accuracy_percent": accuracy(elo_map_trials[weight]), "series_accuracy_percent": accuracy(elo_series_trials[weight])} for weight in elo_map_trials},
    "confirmed_lineup_trials": {str(weight): {"map_accuracy_percent": accuracy(lineup_map_trials[weight]), "series_accuracy_percent": accuracy(lineup_series_trials[weight])} for weight in lineup_map_trials},
    "confirmed_player_form_trials": {str(weight): {"map_accuracy_percent": accuracy(player_form_map_trials[weight]), "series_accuracy_percent": accuracy(player_form_series_trials[weight])} for weight in player_form_map_trials},
}
print(result)
with open(database_path + ".valorant-result.json", "w", encoding="utf-8") as output:
    json.dump(result, output)
