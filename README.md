# LoL Stats Predictor

Hosted League of Legends matchup dashboard using Cloudflare Workers, D1, and static assets. GitHub stores code only; Oracle's Elixir 2022+ historical data is imported remotely into D1.

## Setup

1. Apply D1 migrations and deploy the Worker.
2. Set a strong Cloudflare Worker secret named `IMPORT_TOKEN`.
3. Add these GitHub Actions secrets:
   - `ORACLE_IMPORT_URL`: the deployed Worker URL, for example `https://lol-stats-predictor.example.workers.dev`
   - `ORACLE_IMPORT_TOKEN`: the exact same secret value.

No CSV is downloaded to the laptop. GitHub Actions downloads public Oracle's Elixir CSV files and sends bounded, complete-game batches to the Worker.

## Automated data refresh

The workflow resolves files from the public Oracle Drive folder every day at approximately 00:01 Europe/Tirane time. It automatically backfills the newest unfinished year first: 2026, then 2025, continuing down to 2022. Each scheduled backfill is capped at 1,500 changed games. Once every year is complete, the same daily workflow returns to refreshing the current year.

The daily run hashes the CSV first. If the source file is unchanged, it exits without parsing or writing data. If the file changed, it compares per-game hashes and writes only new or updated games.

## Manual historical import

In GitHub, open **Actions -> Sync Oracle's Elixir data -> Run workflow**.

- Leave the year blank to import the current year from the public Drive folder.
- Enter a year from `2022` onward (for example `2026`) to import that year's CSV from the folder.
- The workflow always resolves the CSV from the configured public Oracle Drive folder.
- Set **max_games** only for a small test or deliberately phased backfill; leave it blank for the complete changed-game set.

Run historical years one at a time. The import is idempotent: restarting a failed year safely skips already-versioned games and updates only missing or changed ones.

## Time-aware prediction model

The predictor does not treat every historical game equally.

- **Recency:** game influence decays with a 60-day half-life, so current form has more influence than older seasons.
- **Current roster:** the five players with the most recent appearances are treated as the active roster. Historical team games are weighted by how many of those players took part.
- **Patch relevance:** games on the newest imported patch receive full weight. Nearby recent patches receive partial weight; old-patch results become a low-weight baseline.
- **Player and champion form:** current-roster KDA and current-patch player win rate are independent model factors. This uses the champions those active players actually played on the current patch, without assuming future draft picks.
- **Transparent factors:** recency-weighted win rate and recent form, 15-minute gold/XP/CS differences, roster continuity, roster KDA, patch form, early objectives, vision, and side results are shown with their weights.

## Map forecasts

Each matchup also includes separate map-level estimates for total kills and game duration. These are calculated from the same roster-, patch-, and recency-weighted completed maps used by each team. The two team distributions are blended, then the site shows an expected value, a typical middle range, and an over/under probability for the lines entered in the dashboard. These forecasts are descriptive probabilities, not guarantees or betting advice.

The displayed data-coverage confidence measures usable recent/roster/patch sample size and available inputs. It is not a guarantee and is not the probability that the selected team wins.

## Stored data and prediction safety

The normalized schema stores matches, teams, team results, player KDA, champions, CS, gold, damage, vision, objective control, 15-minute gold/XP/CS differences, and picks/bans. Missing source values stay null rather than being invented.

Predictions use only completed historical games. Outcome fields from the match being predicted are never used as input, preventing result leakage.
