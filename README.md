# LoL Stats Predictor

Hosted League of Legends matchup dashboard using Cloudflare Workers, D1, and static assets. GitHub stores code only; Oracle's Elixir 2020+ historical data is imported remotely into D1.

## Setup

1. Apply D1 migrations and deploy the Worker.
2. Set a strong Cloudflare Worker secret named `IMPORT_TOKEN`.
3. Add these GitHub Actions secrets:
   - `ORACLE_IMPORT_URL`: the deployed Worker URL, for example `https://lol-stats-predictor.example.workers.dev`
   - `ORACLE_IMPORT_TOKEN`: the exact same secret value.

No CSV is downloaded to the laptop. GitHub Actions downloads public Oracle's Elixir CSV files and sends bounded, complete-game batches to the Worker.

## Automated data refresh

The workflow resolves files from the public Oracle Drive folder and refreshes the current Europe/Tirane year every day at approximately 00:01 local time. Two UTC schedules handle daylight-saving changes; the run outside the local midnight hour exits without importing.

The daily run hashes the CSV first. If the source file is unchanged, it exits without parsing or writing data. If the file changed, it compares per-game hashes and writes only new or updated games.

## Manual historical import

In GitHub, open **Actions -> Sync Oracle's Elixir data -> Run workflow**.

- Leave both inputs blank to import the current year from the public Drive folder.
- Enter a year (for example `2020`) and leave the URL blank to resolve that year's file from the folder.
- Supply a direct CSV URL only when intentionally using a different public source.
- Set **max_games** only for a small test or deliberately phased backfill; leave it blank for the complete changed-game set.

Run historical years one at a time. The import is idempotent: restarting a failed year safely skips already-versioned games and updates only missing or changed ones.

## Stored data and prediction safety

The normalized schema stores matches, teams, team results, player KDA, champions, CS, gold, damage, vision, objective control, 15-minute gold/XP/CS differences, and picks/bans. Missing source values stay null rather than being invented.

Predictions use only historical team aggregates. Outcome fields from the match being predicted are never used as input, preventing result leakage.
