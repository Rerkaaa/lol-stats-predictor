# LoL Stats Predictor

Hosted League of Legends matchup dashboard using Cloudflare Workers, D1, and static assets. GitHub stores code only; Oracle’s Elixir 2020+ historical data lives in D1.

## Before first deployment

1. In the Cloudflare dashboard, open **Workers & Pages → D1 → lol-stats-db** and copy its database ID.
2. Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` in `wrangler.jsonc` with that ID. Do not commit API tokens or secrets.
3. Install Node.js 20 or newer, then run `npm install`.
4. Run `npx wrangler login`, which opens Cloudflare's secure sign-in flow.
5. Create the database tables with `npm run db:migrate`.
6. Deploy with `npm run deploy`.

The deployed Worker serves the static dashboard and the `/api/teams` and `/api/matchup` endpoints. Until historical data is imported, the interface will correctly show no teams.

## Data model

The migration stores tournaments, teams, individual matches, team game stats, player game stats, and picks/bans. This avoids Excel row limits and supports rebuilding team aggregates from the raw match-level facts.

## Historical import: Oracle’s Elixir (2020+)

Historical match data comes exclusively from Oracle’s Elixir 2020+ bulk CSV files, processed remotely by a GitHub Actions workflow and written in batches to D1. Your laptop is not used for the download or import. Gol.gg is not part of the production pipeline.

1. Apply migrations and deploy the Worker.
2. Create a strong random `IMPORT_TOKEN` secret in Cloudflare with `npx.cmd wrangler secret put IMPORT_TOKEN`.
3. Add GitHub repository secrets:
   - `ORACLE_IMPORT_URL`: your Worker URL, for example `https://lol-stats-predictor.example.workers.dev`
   - `ORACLE_IMPORT_TOKEN`: the same token.
4. In GitHub, open **Actions → Import Oracle's Elixir season → Run workflow**. Enter a year and the direct Oracle’s Elixir CSV URL.

The workflow supports batches of 250 source rows and records progress at `/api/import/status`. It imports available Oracle fields—results, sides, team and player KDA, champions, CS, gold, damage, vision, 15-minute gold/XP/CS differences, and objectives. Blank source fields remain blank and are excluded from prediction weighting.
