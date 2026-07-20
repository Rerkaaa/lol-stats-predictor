# LoL Stats Predictor

Hosted League of Legends matchup dashboard using Cloudflare Workers, D1, and static assets. GitHub stores code only; historical data lives in D1.

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

## Import policy

The historical importer has deliberately not been included yet: it needs to be rate-limited, resumable, and validated against Gol.gg's permitted access patterns before collection begins. The initial import should be batched to respect Cloudflare D1's daily write allowance.
