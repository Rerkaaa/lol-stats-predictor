const year = Number(process.argv[2]);
const workerUrl = process.env.ORACLE_IMPORT_URL?.replace(/\/$/, "");
const token = process.env.ORACLE_IMPORT_TOKEN;

if (!Number.isInteger(year) || year < 2020 || !workerUrl || !token) {
  throw new Error("Usage: node scripts/import-leaguepedia-series.mjs YEAR with ORACLE_IMPORT_URL and ORACLE_IMPORT_TOKEN.");
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const fields = "SG.GameId,SG.MatchId,SG.N_GameInMatch,SG.DateTime_UTC,SG.OverviewPage,SG.Team1,SG.Team2,SG.WinTeam,SG.Patch";
const where = `SG.DateTime_UTC >= '${year}-01-01' AND SG.DateTime_UTC < '${year + 1}-01-01'`;

const value = (title, name) => title[`SG.${name}`] ?? title[name] ?? null;

async function request(url) {
  const response = await fetch(url, { headers: { "user-agent": "LoLStatsPredictor/1.0 (personal esports statistics project)" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const reason = data?.error?.code ?? data?.error?.info ?? `HTTP ${response.status}`;
    if (String(reason).toLowerCase().includes("ratelimit")) throw new Error("Leaguepedia rate limit reached; retry this workflow later.");
    throw new Error(`Leaguepedia request failed: ${reason}`);
  }
  return data;
}

async function post(games) {
  const response = await fetch(`${workerUrl}/api/admin/leaguepedia/series-games`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ games }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Worker series import returned HTTP ${response.status}: ${text}`);
  return JSON.parse(text || "{}");
}

let offset = 0;
let imported = 0;
for (;;) {
  const params = new URLSearchParams({ action: "cargoquery", format: "json", tables: "ScoreboardGames=SG", fields, where, order_by: "SG.DateTime_UTC ASC", limit: "500", offset: String(offset) });
  const page = await request(`https://lol.fandom.com/api.php?${params}`);
  const rows = Array.isArray(page.cargoquery) ? page.cargoquery.map((row) => row.title ?? {}) : [];
  const games = rows.map((title) => ({
    gameId: value(title, "GameId"), matchId: value(title, "MatchId"), gameNumber: Number(value(title, "N_GameInMatch")) || null,
    playedAt: value(title, "DateTime_UTC"), competition: value(title, "OverviewPage"), teamA: value(title, "Team1"),
    teamB: value(title, "Team2"), winner: value(title, "WinTeam"), patch: value(title, "Patch"),
  })).filter((game) => game.gameId && game.matchId);
  for (let index = 0; index < games.length; index += 100) imported += Number((await post(games.slice(index, index + 100))).imported ?? 0);
  console.log(JSON.stringify({ year, offset, sourceRows: rows.length, acceptedGames: games.length, imported }));
  if (rows.length < 500) break;
  offset += rows.length;
  await delay(8000);
}
