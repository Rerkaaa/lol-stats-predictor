# Project changelog

This file records the major product and infrastructure changes made to the project. Individual implementation commits remain available in Git history.

## 2026-08-07 — Navigation, search, and Valorant match history

- Reduced the public navigation to three product areas: **League of Legends**, **Valorant**, and **Summoner Lookup**.
- Added contextual navigation inside League and Valorant for **Predict**, **Latest matches**, and **Live / schedule**.
- Replaced team dropdown-only selection with searchable, substring-matching comboboxes. Typing `Bri`, for example, lists every team containing that sequence.
- Added mouse, touch, Arrow key, Enter, Escape, focus, and accessible listbox behavior to team search.
- Added a dedicated **Latest Valorant Matches** view with team and head-to-head filters, series scores, map dropdowns, agents, ACS, and K/D/A.
- Added a history-only Valorant team endpoint mode so teams with fewer than three maps remain searchable in match history without weakening predictor eligibility.
- Applied a League blue-and-yellow visual treatment using `#ffe45c`, Valorant crimson styling, responsive navigation, mobile team search, and mobile match tables.
- Added a display-time repair for legacy mojibake characters still present in older generated frontend strings.
- Kept the three primary product tabs visible while scrolling and added a responsive floating Back to top control for long pages.
- Added the project backlog, monetization guide, and this changelog.

## 2026-08-03 — Private development workspace

- Added the unlinked `/#dev` workspace.
- Protected all development operations with a server-validated, signed, HTTP-only admin session.
- Added D1 storage for visual settings, managed leagues, managed pro teams, managed players, roster memberships, and player Riot accounts.
- Added manual league/team/player/account creation, logo/photo URLs, roster assignment, removal, and advanced CSS overrides.

## July–August 2026 — Live, schedule, and current-data systems

- Added separate League and Valorant live areas.
- Added the official League schedule, championship filtering, and available YouTube/Twitch player choices.
- Added live Valorant match discovery and broadcast links.
- Added hourly Games of Legends fallback imports for recent LoL maps and hourly VLR imports for Valorant.
- Added map discovery for later maps in LoL series and fixed cases where only map one of a Bo3 appeared.
- Added Leaguepedia series metadata ingestion with safe rate-limit handling.
- Added Oracle’s Elixir import verification, changed-game hashing, remote D1 ingestion, and an R2 mirror fallback.

## July 2026 — Predictor development

- Rebuilt LoL prediction around time decay, roster overlap, patch relevance, player/champion form, early-game metrics, opponent-adjusted Elo, lineup confirmation, strength of schedule, tournament weighting, and Bo1/Bo3/Bo5 outputs.
- Added LoL total-kill and duration forecasts with configurable over/under lines.
- Added transparent factor tables, data coverage confidence, expected lineups, team context, and head-to-head history.
- Added full historical backtest workflows for LoL with Brier score and candidate-factor trials.
- Added a Valorant predictor using 2025–2026 imported VLR series/maps, time-aware form, round differential, player form, lineup confirmation, roster continuity, map pool context, rolling meta context, opponent-adjusted Elo, total-round forecasts, and series probabilities.
- Added full Valorant replay/backtest workflows and retained only tested model changes that improved the stored replay result.

## July 2026 — Match and player experience

- Added detailed LoL match analysis with full team rows, summoner names, champions on hover, items, KDA, damage, vision, CS, team totals, MVP/impact summaries, team comparisons, objectives, builds, runes, and interactive Gold/XP/CS timelines.
- Added graph hover tooltips, objective timelines, rune descriptions, player selection, role performance, and responsive wide analysis layouts.
- Added clickable summoner names that open Summoner Lookup.
- Added Summoner Lookup caching, manual updates, favourites, profile icon, level, rank, ladder position where available, mastery, champion form, match filters, history pagination, queue labels, full match details, and stored rank snapshots.

## Initial platform

- Created the Cloudflare Worker, static frontend, D1 schema, GitHub repository, migrations, and deployment configuration.
- Replaced the original Gol.gg scraping direction with structured Oracle’s Elixir data for the historical LoL backbone.
- Kept Gol.gg / Games of Legends-style HTML extraction only as a recent-data fallback where structured fields are incomplete.
- Added idempotent imports so a source game is not inserted twice under the same source identifier.
