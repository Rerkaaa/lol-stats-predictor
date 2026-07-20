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

## Historical import

The project includes a conservative Gol.gg import queue for the public tournament and game pages. It performs at most one source request per minute, stores only normalized data in D1, and retries failures up to three times. It is disabled by default.

After applying the second migration and deploying, enable it with:

```powershell
npx.cmd wrangler secret put IMPORT_ENABLED
```

Enter `true` when prompted. Check progress at `/api/import/status`. To pause, run the same command again and enter `false`.

The initial importer discovers every season, tournament, series and individual game, and stores tournament/team/match metadata. Detailed player, draft, objective and lane-stat parsing will be added in later importer versions rather than guessing when a source layout changes.
