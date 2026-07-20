import {
  buildOracleGame,
  type NormalizedOracleGame,
  type NormalizedOracleRow,
  type OracleGamePayload,
} from "./oracle";

const sourceTeamKey = (name: string) => `oracle:${name.trim().toLowerCase()}`;

const chunks = <T>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
};

const roleOrder = (role: string | null) => {
  const key = role?.trim().toLowerCase() ?? "";
  return ({ top: 1, jng: 2, jungle: 2, mid: 3, bot: 4, adc: 4, bottom: 4, sup: 5, support: 5 } as Record<string, number>)[key] ?? 99;
};

const placeholders = (rows: number, columns: number) =>
  Array.from({ length: rows }, () => `(${Array.from({ length: columns }, () => "?").join(",")})`).join(",");

type TeamIdRow = { id: number; source_key: string };
type MatchIdRow = { id: number; gol_game_id: number };
type VersionRow = { source_hash: string };

export type OracleIngestResult = {
  accepted: number;
  skipped: number;
  rejected: number;
  acceptedRows: number;
  rejectedRows: number;
};

async function resolveTeamIds(db: D1Database, game: NormalizedOracleGame) {
  const teams = [game.blue, game.red].map((row) => ({ name: row.team, key: sourceTeamKey(row.team) }));
  const uniqueTeams = [...new Map(teams.map((team) => [team.key, team])).values()];
  await db.batch(
    uniqueTeams.map((team) =>
      db
        .prepare(
          "INSERT INTO teams(name,source_key,source_url) VALUES(?,?,?) ON CONFLICT(source_key) DO UPDATE SET name=excluded.name,source_url=excluded.source_url",
        )
        .bind(team.name, team.key, `oracle://team/${encodeURIComponent(team.name)}`),
    ),
  );

  const { results = [] } = await db
    .prepare(`SELECT id,source_key FROM teams WHERE source_key IN (${uniqueTeams.map(() => "?").join(",")})`)
    .bind(...uniqueTeams.map((team) => team.key))
    .all<TeamIdRow>();
  const ids = new Map(results.map((team) => [team.source_key, team.id]));
  const blue = ids.get(sourceTeamKey(game.blue.team));
  const red = ids.get(sourceTeamKey(game.red.team));
  if (!blue || !red) throw new Error(`Unable to resolve teams for ${game.gameId}`);
  return { ids, blue, red };
}

function draftRowsForTeam(game: NormalizedOracleGame, team: NormalizedOracleRow, teamId: number, matchId: number) {
  const picks = team.picks.length
    ? team.picks
    : game.players
        .filter((player) => player.team === team.team && player.champion)
        .sort((left, right) => roleOrder(left.role) - roleOrder(right.role))
        .map((player) => player.champion as string);
  const pickRows = picks.map((champion, index) => [matchId, teamId, "pick", index + 1, champion]);
  const banRows = team.bans.map((champion, index) => [matchId, teamId, "ban", index + 1, champion]);
  return [...pickRows, ...banRows];
}

async function writeGame(db: D1Database, game: NormalizedOracleGame, sourceYear: number, sourceUrl: string) {
  const sourceGameId = `oracle:${game.gameId}`;
  const { ids, blue, red } = await resolveTeamIds(db, game);
  const existing = await db
    .prepare("SELECT id,gol_game_id FROM matches WHERE source_game_id=?")
    .bind(sourceGameId)
    .first<MatchIdRow>();
  const legacyId =
    existing?.gol_game_id ??
    (await db.prepare("SELECT COALESCE(MIN(gol_game_id),0)-1 AS id FROM matches").first<{ id: number }>())?.id ??
    -1;
  const winner = game.blue.result === 1 ? blue : game.red.result === 1 ? red : null;
  const duration = game.blue.gameLength ?? game.red.gameLength;

  await db
    .prepare(
      `INSERT INTO matches(gol_game_id,source_game_id,played_at,patch,stage,blue_team_id,red_team_id,winner_team_id,duration_seconds,source_url)
       VALUES(?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(source_game_id) DO UPDATE SET
         played_at=excluded.played_at,patch=excluded.patch,stage=excluded.stage,
         blue_team_id=excluded.blue_team_id,red_team_id=excluded.red_team_id,
         winner_team_id=excluded.winner_team_id,duration_seconds=excluded.duration_seconds,source_url=excluded.source_url`,
    )
    .bind(legacyId, sourceGameId, game.date, game.patch, game.league, blue, red, winner, duration, sourceUrl)
    .run();

  const match = await db.prepare("SELECT id FROM matches WHERE source_game_id=?").bind(sourceGameId).first<{ id: number }>();
  if (!match) throw new Error(`Unable to resolve match ${game.gameId}`);

  const teamRows = [game.blue, game.red];
  const teamValues = teamRows.flatMap((team) => [
    match.id,
    ids.get(sourceTeamKey(team.team)),
    team.side,
    team.result,
    team.kills,
    team.deaths,
    team.assists,
    team.gold,
    team.goldPerMinute,
    team.goldDiff15,
    team.xpDiff15,
    team.csDiff15,
    team.firstBlood,
    team.firstTower,
    team.dragons,
    team.barons,
    team.heralds,
    team.towers,
    team.visionScorePerMinute,
  ]);
  const playerRows = game.players.flatMap((player) => {
    const teamId = ids.get(sourceTeamKey(player.team));
    if (!teamId || !player.player) return [];
    return [[match.id, teamId, player.player, player.role, player.champion, player.kills, player.deaths, player.assists, player.cs, player.gold, player.damage, player.visionScore]];
  });
  const draftRows = [
    ...draftRowsForTeam(game, game.blue, blue, match.id),
    ...draftRowsForTeam(game, game.red, red, match.id),
  ];

  const statements = [
    db.prepare("DELETE FROM team_game_stats WHERE match_id=?").bind(match.id),
    db.prepare("DELETE FROM player_game_stats WHERE match_id=?").bind(match.id),
    db.prepare("DELETE FROM drafts WHERE match_id=?").bind(match.id),
    db
      .prepare(
        `INSERT INTO team_game_stats(match_id,team_id,side,won,kills,deaths,assists,gold,gold_per_minute,gold_diff_15,xp_diff_15,cs_diff_15,first_blood,first_tower,dragons,barons,heralds,towers,vision_score_per_minute)
         VALUES ${placeholders(teamRows.length, 19)}`,
      )
      .bind(...teamValues),
  ];

  for (const batch of chunks(playerRows, 5)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO player_game_stats(match_id,team_id,player_name,role,champion,kills,deaths,assists,cs,gold,damage,vision_score)
           VALUES ${placeholders(batch.length, 12)}`,
        )
        .bind(...batch.flat()),
    );
  }

  for (const batch of chunks(draftRows, 10)) {
    statements.push(
      db
        .prepare(`INSERT INTO drafts(match_id,team_id,phase,sequence_no,champion) VALUES ${placeholders(batch.length, 5)}`)
        .bind(...batch.flat()),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO oracle_game_versions(source_game_id,source_year,source_hash,source_url,imported_at)
         VALUES(?,?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT(source_game_id) DO UPDATE SET
           source_year=excluded.source_year,source_hash=excluded.source_hash,source_url=excluded.source_url,imported_at=CURRENT_TIMESTAMP`,
      )
      .bind(sourceGameId, sourceYear, game.sourceHash, sourceUrl),
  );
  await db.batch(statements);
}

export async function ingestOracleGames(db: D1Database, sourceYear: number, sourceUrl: string, payloads: OracleGamePayload[]): Promise<OracleIngestResult> {
  const result: OracleIngestResult = { accepted: 0, skipped: 0, rejected: 0, acceptedRows: 0, rejectedRows: 0 };
  for (const payload of payloads) {
    const game = buildOracleGame(payload);
    if (!game) {
      result.rejected++;
      result.rejectedRows += payload.rows.length;
      continue;
    }

    const sourceGameId = `oracle:${game.gameId}`;
    const version = await db.prepare("SELECT source_hash FROM oracle_game_versions WHERE source_game_id=?").bind(sourceGameId).first<VersionRow>();
    if (version?.source_hash === game.sourceHash) {
      result.skipped++;
      continue;
    }

    await writeGame(db, game, sourceYear, sourceUrl);
    result.accepted++;
    result.acceptedRows += payload.rows.length;
  }
  return result;
}
