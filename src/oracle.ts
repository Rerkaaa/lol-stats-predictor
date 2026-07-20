export type OracleRow = Record<string, string>;

export type OracleGamePayload = {
  gameId: string;
  sourceHash: string;
  rows: OracleRow[];
};

export type NormalizedOracleRow = {
  gameId: string;
  isTeamRow: boolean;
  dataCompleteness: string | null;
  league: string | null;
  date: string | null;
  patch: string | null;
  side: "blue" | "red";
  team: string;
  player: string | null;
  role: string | null;
  champion: string | null;
  result: number;
  gameLength: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  cs: number | null;
  gold: number | null;
  goldPerMinute: number | null;
  damage: number | null;
  visionScore: number | null;
  visionScorePerMinute: number | null;
  goldDiff15: number | null;
  xpDiff15: number | null;
  csDiff15: number | null;
  firstBlood: number | null;
  firstTower: number | null;
  dragons: number | null;
  barons: number | null;
  heralds: number | null;
  towers: number | null;
  bans: string[];
  picks: string[];
};

export type NormalizedOracleGame = {
  gameId: string;
  sourceHash: string;
  league: string | null;
  date: string | null;
  patch: string | null;
  blue: NormalizedOracleRow;
  red: NormalizedOracleRow;
  players: NormalizedOracleRow[];
};

const value = (row: OracleRow, ...keys: string[]) =>
  keys.map((key) => row[key]).find((item) => item !== undefined && item !== "") ?? null;

const number = (row: OracleRow, ...keys: string[]) => {
  const raw = value(row, ...keys);
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const championList = (row: OracleRow, prefix: "ban" | "pick") =>
  [1, 2, 3, 4, 5]
    .map((index) => value(row, `${prefix}${index}`)?.trim() ?? "")
    .filter((champion) => champion.length > 0);

export function normalizeOracleRow(row: OracleRow): NormalizedOracleRow | null {
  const gameId = value(row, "gameid", "game_id");
  const side = value(row, "side")?.toLowerCase();
  const team = value(row, "teamname", "team");
  if (!gameId || !team || (side !== "blue" && side !== "red")) return null;

  const result = number(row, "result");
  if (result !== 0 && result !== 1) return null;

  const participant = number(row, "participantid", "participant_id");
  return {
    gameId,
    isTeamRow: participant === 100 || participant === 200,
    dataCompleteness: value(row, "datacompleteness")?.toLowerCase() ?? null,
    league: value(row, "league"),
    date: value(row, "date", "game_date"),
    patch: value(row, "patch"),
    side,
    team,
    player: value(row, "playername", "player"),
    role: value(row, "position", "role"),
    champion: value(row, "champion"),
    result,
    gameLength: number(row, "gamelength", "game_length"),
    kills: number(row, "kills"),
    deaths: number(row, "deaths"),
    assists: number(row, "assists"),
    cs: number(row, "total cs", "total_cs", "cs"),
    gold: number(row, "totalgold", "total_gold", "gold"),
    goldPerMinute: number(row, "earned gpm", "gpm", "goldperminute"),
    damage: number(row, "damagetochampions", "damage"),
    visionScore: number(row, "visionscore", "vision_score"),
    visionScorePerMinute: number(row, "vspm", "vision_score_per_minute"),
    goldDiff15: number(row, "golddiffat15", "gold_diff_15"),
    xpDiff15: number(row, "xpdiffat15", "xp_diff_15"),
    csDiff15: number(row, "csdiffat15", "cs_diff_15"),
    firstBlood: number(row, "firstblood"),
    firstTower: number(row, "firsttower"),
    dragons: number(row, "dragons"),
    barons: number(row, "barons"),
    heralds: number(row, "heralds"),
    towers: number(row, "towers"),
    bans: championList(row, "ban"),
    picks: championList(row, "pick"),
  };
}

export function buildOracleGame(payload: OracleGamePayload): NormalizedOracleGame | null {
  const normalized = payload.rows
    .map(normalizeOracleRow)
    .filter((row): row is NormalizedOracleRow => row !== null && row.gameId === payload.gameId);
  const blue = normalized.find((row) => row.isTeamRow && row.side === "blue");
  const red = normalized.find((row) => row.isTeamRow && row.side === "red");

  if (!blue || !red) return null;
  if ([blue, red].some((row) => row.dataCompleteness && row.dataCompleteness !== "complete")) return null;

  const teamNames = new Set([blue.team, red.team]);
  const players = normalized.filter((row) => !row.isTeamRow && !!row.player && teamNames.has(row.team));
  return {
    gameId: payload.gameId,
    sourceHash: payload.sourceHash,
    league: blue.league ?? red.league,
    date: blue.date ?? red.date,
    patch: blue.patch ?? red.patch,
    blue,
    red,
    players,
  };
}
