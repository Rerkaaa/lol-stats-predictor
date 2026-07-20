import { ingestOracleGames } from "./oracle-ingest";
import type { OracleGamePayload } from "./oracle";
import { predictTimeAware, profileTeam, type PlayerGame, type RosterPlayer, type TeamGame } from "./prediction";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  IMPORT_TOKEN?: string;
}

type TeamRow = { id: number; name: string };
type RosterDbRow = { name: string; role: string | null; games: number };
type TeamGameDbRow = Omit<TeamGame, "rosterOverlap">;
type PlayerGameDbRow = PlayerGame & { matchId: number; playerName: string };

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

async function currentPatch(db: D1Database) {
  return db.prepare("SELECT patch,played_at playedAt FROM matches WHERE source_game_id LIKE 'oracle:%' AND played_at>='2022-01-01' AND patch IS NOT NULL AND patch<>'' ORDER BY played_at DESC LIMIT 1").first<{ patch: string; playedAt: string | null }>();
}

async function teamProfile(db: D1Database, id: number, patch: string | null, referenceDate: Date) {
  const team = await db.prepare("SELECT id,name FROM teams WHERE id=?").bind(id).first<TeamRow>();
  if (!team) return null;
  const { results: rosterRows = [] } = await db
    .prepare(
      `SELECT p.player_name name,MAX(p.role) role,COUNT(*) games
       FROM player_game_stats p JOIN matches m ON m.id=p.match_id
       WHERE p.team_id=? AND m.source_game_id LIKE 'oracle:%' AND m.played_at>='2022-01-01' GROUP BY p.player_name ORDER BY MAX(m.played_at) DESC,COUNT(*) DESC LIMIT 5`,
    )
    .bind(id)
    .all<RosterDbRow>();
  const roster: RosterPlayer[] = rosterRows.map((row) => ({ name: row.name, role: row.role, games: Number(row.games) }));
  const { results: gameRows = [] } = await db
    .prepare(
      `SELECT s.match_id matchId,m.played_at playedAt,m.patch,s.side,s.won,s.kills,s.deaths,s.assists,
        m.duration_seconds durationSeconds,s.gold_diff_15 goldDiff15,s.xp_diff_15 xpDiff15,s.cs_diff_15 csDiff15,s.first_blood firstBlood,
        s.first_tower firstTower,s.dragons,s.barons,s.vision_score_per_minute vision
       FROM team_game_stats s JOIN matches m ON m.id=s.match_id WHERE s.team_id=? AND m.source_game_id LIKE 'oracle:%' AND m.played_at>='2022-01-01' ORDER BY m.played_at DESC`,
    )
    .bind(id)
    .all<TeamGameDbRow>();
  if (!gameRows.length) return null;
  const playerStatement = roster.length
    ? db.prepare(
        `SELECT p.match_id matchId,p.player_name playerName,m.played_at playedAt,m.patch,s.won,p.kills,p.deaths,p.assists,p.champion
         FROM player_game_stats p JOIN matches m ON m.id=p.match_id JOIN team_game_stats s ON s.match_id=p.match_id AND s.team_id=p.team_id
         WHERE p.team_id=? AND p.player_name IN (${roster.map(() => "?").join(",")}) AND m.source_game_id LIKE 'oracle:%' AND m.played_at>='2022-01-01'`,
      ).bind(id, ...roster.map((player) => player.name))
    : db.prepare("SELECT NULL matchId,NULL playerName,NULL playedAt,NULL patch,NULL won,NULL kills,NULL deaths,NULL assists,NULL champion WHERE 0");
  const { results: playerRows = [] } = await playerStatement.all<PlayerGameDbRow>();
  const rosterByMatch = new Map<number, Set<string>>();
  for (const row of playerRows) {
    const players = rosterByMatch.get(row.matchId) ?? new Set<string>();
    players.add(row.playerName);
    rosterByMatch.set(row.matchId, players);
  }
  const games: TeamGame[] = gameRows.map((row) => ({ ...row, rosterOverlap: rosterByMatch.get(row.matchId)?.size ?? 0 }));
  const playerGames: PlayerGame[] = playerRows.map(({ matchId: _matchId, playerName: _playerName, ...row }) => row);
  return profileTeam(team.id, team.name, games, roster, playerGames, patch, referenceDate);
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
      if (!Array.isArray(supplied) || supplied.length < 1 || supplied.length > 80) return json({ error: "Expected 1-80 game hashes." }, 400);
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
    if (url.pathname === "/api/health") return json({ ok: true, source: "Oracle's Elixir", coverage: "2022+" });
    if (url.pathname === "/api/import/status") {
      const { results } = await env.DB
        .prepare("SELECT source_year,status,source_hash,rows_received,rows_rejected,games_received,games_skipped,last_error,source_url,started_at,completed_at FROM oracle_import_runs ORDER BY source_year DESC")
        .all();
      return json({ source: "Oracle's Elixir", coverage: "2022+", imports: results });
    }
    if (url.pathname === "/api/teams") {
      const { results } = await env.DB
        .prepare("SELECT t.id,t.name,COUNT(s.match_id) games FROM teams t JOIN team_game_stats s ON s.team_id=t.id JOIN matches m ON m.id=s.match_id WHERE m.source_game_id LIKE 'oracle:%' AND m.played_at>='2022-01-01' GROUP BY t.id,t.name HAVING games>0 ORDER BY t.name")
        .all();
      return json(results);
    }
    if (url.pathname === "/api/matchup") {
      const leftId = Number(url.searchParams.get("teamA"));
      const rightId = Number(url.searchParams.get("teamB"));
      if (!Number.isInteger(leftId) || !Number.isInteger(rightId) || leftId === rightId) return json({ error: "Select two distinct teams." }, 400);
      const requestedLine = (key: string, minimum: number, maximum: number) => {
        const value = Number(url.searchParams.get(key));
        return Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
      };
      const killsLine = requestedLine("killsLine", 1, 100);
      const durationLine = requestedLine("durationLine", 10, 90);
      const latest = await currentPatch(env.DB);
      const patch = latest?.patch ?? null;
      const referenceDate = latest?.playedAt ? new Date(`${latest.playedAt.replace(" ", "T")}Z`) : new Date();
      const [left, right] = await Promise.all([teamProfile(env.DB, leftId, patch, referenceDate), teamProfile(env.DB, rightId, patch, referenceDate)]);
      if (!left || !right) return json({ error: "Both teams need imported Oracle's Elixir statistics." }, 404);
      const prediction = predictTimeAware(left, right, killsLine, durationLine);
      return json({
        teamA: left.name,
        teamB: right.name,
        ...prediction,
        model: "Time-aware roster and patch model",
        currentPatch: patch,
        asOf: latest?.playedAt ?? [left.lastGameAt, right.lastGameAt].filter((date): date is string => !!date).sort().at(-1) ?? null,
        teamAContext: { games: left.games, effectiveGames: left.effectiveGames, recentGames: left.recentGames, roster: left.roster, patchPlayerGames: left.patchPlayerGames },
        teamBContext: { games: right.games, effectiveGames: right.effectiveGames, recentGames: right.recentGames, roster: right.roster, patchPlayerGames: right.patchPlayerGames },
      });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
