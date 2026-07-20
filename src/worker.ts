import { ingestOracleGames } from "./oracle-ingest";
import type { OracleGamePayload } from "./oracle";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  IMPORT_TOKEN?: string;
}

type TeamStats = {
  id: number;
  name: string;
  games: number;
  wins: number;
  winRate: number;
  gd15: number | null;
  xp15: number | null;
  cs15: number | null;
  kda: number | null;
  firstBlood: number | null;
  firstTower: number | null;
  dragons: number | null;
  barons: number | null;
  vision: number | null;
  blueRate: number | null;
  redRate: number | null;
};

type StartImportBody = { year?: number; sourceUrl?: string; sourceHash?: string };
type ChangedGamesBody = StartImportBody & { games?: Array<{ gameId?: string; sourceHash?: string }> };
type GamesBody = StartImportBody & { games?: OracleGamePayload[] };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const validStart = (body: StartImportBody) => Number.isInteger(body.year) && (body.year as number) >= 2020 && typeof body.sourceUrl === "string" && body.sourceUrl.length > 0 && validHash(body.sourceHash);

const authorized = (request: Request, env: Env) =>
  !!env.IMPORT_TOKEN && request.headers.get("authorization") === `Bearer ${env.IMPORT_TOKEN}`;

async function stats(db: D1Database, id: number) {
  return db
    .prepare(
      `SELECT t.id,t.name,COUNT(s.match_id) games,SUM(s.won) wins,AVG(s.won) winRate,
        AVG(s.gold_diff_15) gd15,AVG(s.xp_diff_15) xp15,AVG(s.cs_diff_15) cs15,
        AVG(CAST(s.kills+s.assists AS REAL)/NULLIF(s.deaths,0)) kda,AVG(s.first_blood) firstBlood,
        AVG(s.first_tower) firstTower,AVG(s.dragons) dragons,AVG(s.barons) barons,
        AVG(s.vision_score_per_minute) vision,AVG(CASE WHEN s.side='blue' THEN s.won END) blueRate,
        AVG(CASE WHEN s.side='red' THEN s.won END) redRate
       FROM teams t JOIN team_game_stats s ON s.team_id=t.id WHERE t.id=? GROUP BY t.id,t.name`,
    )
    .bind(id)
    .first<TeamStats>();
}

function relative(left: number | null, right: number | null) {
  return left === null || right === null ? null : (left - right) / (Math.abs(left) + Math.abs(right) + 1);
}

function predict(left: TeamStats, right: TeamStats) {
  const fields: [string, number | null, number | null, number][] = [
    ["Win rate", left.winRate, right.winRate, 0.25],
    ["Gold diff @15", left.gd15, right.gd15, 0.18],
    ["XP diff @15", left.xp15, right.xp15, 0.12],
    ["CS diff @15", left.cs15, right.cs15, 0.08],
    ["KDA", left.kda, right.kda, 0.1],
    ["First blood", left.firstBlood, right.firstBlood, 0.07],
    ["First tower", left.firstTower, right.firstTower, 0.06],
    ["Dragons / game", left.dragons, right.dragons, 0.05],
    ["Barons / game", left.barons, right.barons, 0.04],
    ["Vision / min", left.vision, right.vision, 0.03],
    ["Side win rate", ((left.blueRate ?? 0) + (left.redRate ?? 0)) / 2, ((right.blueRate ?? 0) + (right.redRate ?? 0)) / 2, 0.02],
  ];
  const factors = fields.map(([name, leftValue, rightValue, weight]) => ({ name, edge: relative(leftValue, rightValue), weight }));
  const available = factors.filter((factor) => factor.edge !== null);
  const activeWeight = available.reduce((total, factor) => total + factor.weight, 0);
  const score = activeWeight ? available.reduce((total, factor) => total + (factor.edge ?? 0) * factor.weight / activeWeight, 0) * 2.8 : 0;
  const probabilityA = 1 / (1 + Math.exp(-score));
  return { teamA: left.name, teamB: right.name, probabilityA, probabilityB: 1 - probabilityA, confidence: Math.min(1, Math.min(left.games, right.games) / 30) * activeWeight, activeWeight, factors };
}

async function startImport(db: D1Database, body: Required<StartImportBody>) {
  const existing = await db
    .prepare("SELECT source_hash,status FROM oracle_import_runs WHERE source_year=?")
    .bind(body.year)
    .first<{ source_hash: string | null; status: string }>();
  if (existing?.source_hash === body.sourceHash && existing.status === "complete") return { unchanged: true };

  await db
    .prepare(
      `INSERT INTO oracle_import_runs(source_year,source_url,source_hash,status,rows_received,rows_rejected,games_received,games_skipped,last_error,started_at,completed_at)
       VALUES(?,?,?,'running',0,0,0,0,NULL,CURRENT_TIMESTAMP,NULL)
       ON CONFLICT(source_year) DO UPDATE SET
         source_url=excluded.source_url,source_hash=excluded.source_hash,status='running',
         rows_received=0,rows_rejected=0,games_received=0,games_skipped=0,last_error=NULL,
         started_at=CURRENT_TIMESTAMP,completed_at=NULL`,
    )
    .bind(body.year, body.sourceUrl, body.sourceHash)
    .run();
  return { unchanged: false };
}

async function markImportFailure(db: D1Database, year: number | undefined, error: unknown) {
  if (!Number.isInteger(year)) return;
  await db
    .prepare("UPDATE oracle_import_runs SET status='failed',last_error=? WHERE source_year=?")
    .bind(errorMessage(error).slice(0, 1500), year)
    .run()
    .catch(() => undefined);
}

async function handleOracleAdmin(request: Request, env: Env, pathname: string) {
  if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await request.json() as StartImportBody & ChangedGamesBody & GamesBody;
  if (!validStart(body)) return json({ error: "Expected a 2020+ year, source URL, and SHA-256 source hash." }, 400);
  const start = { year: body.year as number, sourceUrl: body.sourceUrl as string, sourceHash: body.sourceHash as string };

  try {
    if (pathname === "/api/admin/oracle/start") return json(await startImport(env.DB, start));

    if (pathname === "/api/admin/oracle/changed-games") {
      const supplied = body.games;
      if (!Array.isArray(supplied) || supplied.length < 1 || supplied.length > 200) return json({ error: "Expected 1-200 game hashes." }, 400);
      const games = supplied.filter((game): game is { gameId: string; sourceHash: string } => typeof game?.gameId === "string" && game.gameId.length > 0 && validHash(game.sourceHash));
      if (games.length !== supplied.length) return json({ error: "Every game needs an ID and SHA-256 hash." }, 400);
      const sourceIds = games.map((game) => `oracle:${game.gameId}`);
      const { results = [] } = await env.DB
        .prepare(`SELECT source_game_id,source_hash FROM oracle_game_versions WHERE source_game_id IN (${sourceIds.map(() => "?").join(",")})`)
        .bind(...sourceIds)
        .all<{ source_game_id: string; source_hash: string }>();
      const stored = new Map(results.map((row) => [row.source_game_id, row.source_hash]));
      return json({ changedGameIds: games.filter((game) => stored.get(`oracle:${game.gameId}`) !== game.sourceHash).map((game) => game.gameId) });
    }

    if (pathname === "/api/admin/oracle/games") {
      const games = body.games;
      if (!Array.isArray(games) || games.length < 1 || games.length > 2 || !games.every((game) => typeof game?.gameId === "string" && validHash(game.sourceHash) && Array.isArray(game.rows) && game.rows.length > 0)) {
        return json({ error: "Expected 1-2 complete games with SHA-256 hashes." }, 400);
      }
      const result = await ingestOracleGames(env.DB, start.year, start.sourceUrl, games);
      await env.DB
        .prepare("UPDATE oracle_import_runs SET rows_received=rows_received+?,rows_rejected=rows_rejected+?,games_received=games_received+?,games_skipped=games_skipped+? WHERE source_year=?")
        .bind(result.acceptedRows, result.rejectedRows, result.accepted, result.skipped, start.year)
        .run();
      return json(result);
    }

    if (pathname === "/api/admin/oracle/complete") {
      const update = await env.DB
        .prepare("UPDATE oracle_import_runs SET status='complete',completed_at=CURRENT_TIMESTAMP WHERE source_year=? AND source_hash=?")
        .bind(start.year, start.sourceHash)
        .run();
      return update.meta.changes ? json({ complete: true }) : json({ error: "No matching import was started." }, 409);
    }

    if (pathname === "/api/admin/oracle/rows") return json({ error: "This importer was replaced by the bounded /games endpoint. Update the GitHub workflow before retrying." }, 410);
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error("Oracle import failed", error);
    await markImportFailure(env.DB, start.year, error);
    return json({ error: "Oracle import failed", detail: errorMessage(error) }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/admin/oracle/")) return handleOracleAdmin(request, env, url.pathname);
    if (url.pathname === "/api/health") return json({ ok: true, source: "Oracle's Elixir", coverage: "2020+" });
    if (url.pathname === "/api/import/status") {
      const { results } = await env.DB
        .prepare("SELECT source_year,status,source_hash,rows_received,rows_rejected,games_received,games_skipped,last_error,source_url,started_at,completed_at FROM oracle_import_runs ORDER BY source_year DESC")
        .all();
      return json({ source: "Oracle's Elixir", coverage: "2020+", imports: results });
    }
    if (url.pathname === "/api/teams") {
      const { results } = await env.DB
        .prepare("SELECT t.id,t.name,COUNT(s.match_id) games FROM teams t JOIN team_game_stats s ON s.team_id=t.id GROUP BY t.id,t.name HAVING games>0 ORDER BY t.name")
        .all();
      return json(results);
    }
    if (url.pathname === "/api/matchup") {
      const leftId = Number(url.searchParams.get("teamA"));
      const rightId = Number(url.searchParams.get("teamB"));
      if (!Number.isInteger(leftId) || !Number.isInteger(rightId) || leftId === rightId) return json({ error: "Select two distinct teams." }, 400);
      const [left, right] = await Promise.all([stats(env.DB, leftId), stats(env.DB, rightId)]);
      if (!left || !right) return json({ error: "Both teams need imported Oracle's Elixir statistics." }, 404);
      return json(predict(left, right));
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
