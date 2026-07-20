export type TeamGame = {
  matchId: number;
  playedAt: string | null;
  patch: string | null;
  side: string;
  won: number;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  durationSeconds: number | null;
  goldDiff15: number | null;
  xpDiff15: number | null;
  csDiff15: number | null;
  firstBlood: number | null;
  firstTower: number | null;
  dragons: number | null;
  barons: number | null;
  vision: number | null;
  rosterOverlap: number;
};

export type RosterPlayer = { name: string; role: string | null; games: number };
export type PlayerGame = {
  playedAt: string | null;
  patch: string | null;
  won: number;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  champion: string | null;
};

export type TeamProfile = {
  id: number;
  name: string;
  games: number;
  effectiveGames: number;
  recentGames: number;
  currentPatch: string | null;
  lastGameAt: string | null;
  roster: RosterPlayer[];
  rosterGames: number;
  patchPlayerGames: number;
  winRate: number | null;
  recentWinRate: number | null;
  gd15: number | null;
  xp15: number | null;
  cs15: number | null;
  kda: number | null;
  rosterKda: number | null;
  patchPlayerWinRate: number | null;
  firstBlood: number | null;
  firstTower: number | null;
  dragons: number | null;
  barons: number | null;
  vision: number | null;
  sideWinRate: number | null;
  rosterContinuity: number | null;
  totalKills: number | null;
  totalKillsDeviation: number | null;
  durationMinutes: number | null;
  durationDeviation: number | null;
};

export type PredictionFactor = { name: string; edge: number | null; weight: number };

const DAY = 86_400_000;
const number = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? null : value);
const clamp = (value: number) => Math.max(-1, Math.min(1, value));

function daysSince(playedAt: string | null, now: Date) {
  if (!playedAt) return 365;
  const parsed = Date.parse(playedAt.endsWith("Z") ? playedAt : `${playedAt.replace(" ", "T")}Z`);
  return Number.isFinite(parsed) ? Math.max(0, (now.getTime() - parsed) / DAY) : 365;
}

function weightedAverage(values: Array<[number | null, number]>) {
  let total = 0;
  let weight = 0;
  for (const [value, itemWeight] of values) {
    if (value === null || !Number.isFinite(value) || itemWeight <= 0) continue;
    total += value * itemWeight;
    weight += itemWeight;
  }
  return weight ? total / weight : null;
}

function weightedDistribution(values: Array<[number | null, number]>) {
  const mean = weightedAverage(values);
  if (mean === null) return { mean: null, deviation: null };
  let total = 0;
  let weight = 0;
  for (const [value, itemWeight] of values) {
    if (value === null || !Number.isFinite(value) || itemWeight <= 0) continue;
    total += (value - mean) ** 2 * itemWeight;
    weight += itemWeight;
  }
  return { mean, deviation: weight ? Math.sqrt(total / weight) : null };
}

function gameWeight(game: TeamGame, currentPatch: string | null, rosterSize: number, now: Date) {
  const age = daysSince(game.playedAt, now);
  const recency = Math.max(0.08, 0.5 ** (age / 60));
  const patch = currentPatch && game.patch === currentPatch ? 1 : age <= 45 ? 0.7 : age <= 120 ? 0.35 : 0.15;
  const continuity = rosterSize ? 0.35 + 0.65 * Math.min(1, game.rosterOverlap / rosterSize) : 0.7;
  return recency * patch * continuity;
}

export function profileTeam(
  id: number,
  name: string,
  games: TeamGame[],
  roster: RosterPlayer[],
  playerGames: PlayerGame[],
  currentPatch: string | null,
  now = new Date(),
): TeamProfile {
  const rosterSize = roster.length;
  const weighted = games.map((game) => [game, gameWeight(game, currentPatch, rosterSize, now)] as const);
  const value = (selector: (game: TeamGame) => number | null) => weightedAverage(weighted.map(([game, weight]) => [selector(game), weight]));
  const recent = games.filter((game) => daysSince(game.playedAt, now) <= 45);
  const currentPlayers = playerGames.filter((game) => currentPatch && game.patch === currentPatch);
  const playerWeight = (game: PlayerGame) => Math.max(0.1, 0.5 ** (daysSince(game.playedAt, now) / 45));
  const playerKda = weightedAverage(playerGames.map((game) => {
    const kills = number(game.kills), assists = number(game.assists), deaths = number(game.deaths);
    return [kills === null || assists === null || deaths === null || deaths === 0 ? null : (kills + assists) / deaths, playerWeight(game)];
  }));
  const patchPlayerWinRate = weightedAverage(currentPlayers.map((game) => [number(game.won), playerWeight(game)]));
  const sideRates = ["blue", "red"].map((side) => weightedAverage(weighted.filter(([game]) => game.side === side).map(([game, weight]) => [game.won, weight])));
  const continuity = weightedAverage(weighted.map(([game, weight]) => [rosterSize ? Math.min(1, game.rosterOverlap / rosterSize) : null, weight]));
  const effectiveGames = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  const lastGameAt = games.map((game) => game.playedAt).filter((date): date is string => !!date).sort().at(-1) ?? null;
  const killsDistribution = weightedDistribution(weighted.map(([game, weight]) => [game.kills === null || game.deaths === null ? null : game.kills + game.deaths, weight]));
  const durationDistribution = weightedDistribution(weighted.map(([game, weight]) => [game.durationSeconds === null ? null : game.durationSeconds / 60, weight]));

  return {
    id, name, games: games.length, effectiveGames, recentGames: recent.length, currentPatch, lastGameAt, roster,
    rosterGames: playerGames.length, patchPlayerGames: currentPlayers.length,
    winRate: value((game) => game.won),
    recentWinRate: recent.length ? recent.reduce((sum, game) => sum + game.won, 0) / recent.length : null,
    gd15: value((game) => game.goldDiff15), xp15: value((game) => game.xpDiff15), cs15: value((game) => game.csDiff15),
    kda: value((game) => game.deaths === null || game.deaths === 0 || game.kills === null || game.assists === null ? null : (game.kills + game.assists) / game.deaths),
    rosterKda: playerKda, patchPlayerWinRate, firstBlood: value((game) => game.firstBlood), firstTower: value((game) => game.firstTower),
    dragons: value((game) => game.dragons), barons: value((game) => game.barons), vision: value((game) => game.vision),
    sideWinRate: sideRates[0] === null || sideRates[1] === null ? null : (sideRates[0] + sideRates[1]) / 2,
    rosterContinuity: continuity,
    totalKills: killsDistribution.mean, totalKillsDeviation: killsDistribution.deviation,
    durationMinutes: durationDistribution.mean, durationDeviation: durationDistribution.deviation,
  };
}

function scaledEdge(left: number | null, right: number | null, scale: number) {
  return left === null || right === null ? null : clamp((left - right) / scale);
}

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const z = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z));
  return 0.5 * (1 + sign * erf);
}

function mapForecast(
  leftMean: number | null,
  rightMean: number | null,
  leftDeviation: number | null,
  rightDeviation: number | null,
  line: number | null,
  floor: number,
) {
  if (leftMean === null || rightMean === null) return null;
  const expected = (leftMean + rightMean) / 2;
  const deviation = Math.max(floor, Math.sqrt(((leftDeviation ?? floor) ** 2 + (rightDeviation ?? floor) ** 2) / 2));
  const lineProbability = line === null ? null : 1 - normalCdf((line - expected) / deviation);
  return {
    expected,
    typicalLow: expected - 0.67449 * deviation,
    typicalHigh: expected + 0.67449 * deviation,
    line,
    probabilityOverLine: lineProbability,
    probabilityUnderLine: lineProbability === null ? null : 1 - lineProbability,
  };
}

export function predictTimeAware(left: TeamProfile, right: TeamProfile, killsLine: number | null = null, durationLine: number | null = null) {
  const factors: PredictionFactor[] = [
    { name: "Recency-weighted win rate", edge: scaledEdge(left.winRate, right.winRate, 0.2), weight: 0.18 },
    { name: "Recent 45-day form", edge: scaledEdge(left.recentWinRate, right.recentWinRate, 0.25), weight: 0.12 },
    { name: "Gold diff @15", edge: scaledEdge(left.gd15, right.gd15, 1200), weight: 0.14 },
    { name: "XP diff @15", edge: scaledEdge(left.xp15, right.xp15, 1000), weight: 0.09 },
    { name: "CS diff @15", edge: scaledEdge(left.cs15, right.cs15, 20), weight: 0.05 },
    { name: "Current-roster continuity", edge: scaledEdge(left.rosterContinuity, right.rosterContinuity, 0.45), weight: 0.08 },
    { name: "Current-roster KDA", edge: scaledEdge(left.rosterKda, right.rosterKda, 1.5), weight: 0.08 },
    { name: "Current-patch player form", edge: scaledEdge(left.patchPlayerWinRate, right.patchPlayerWinRate, 0.25), weight: 0.08 },
    { name: "First blood", edge: scaledEdge(left.firstBlood, right.firstBlood, 0.2), weight: 0.04 },
    { name: "First tower", edge: scaledEdge(left.firstTower, right.firstTower, 0.2), weight: 0.04 },
    { name: "Objectives / game", edge: scaledEdge((left.dragons ?? 0) + (left.barons ?? 0), (right.dragons ?? 0) + (right.barons ?? 0), 1), weight: 0.05 },
    { name: "Vision / min", edge: scaledEdge(left.vision, right.vision, 0.8), weight: 0.03 },
    { name: "Side win rate", edge: scaledEdge(left.sideWinRate, right.sideWinRate, 0.25), weight: 0.02 },
  ];
  const available = factors.filter((factor) => factor.edge !== null);
  const activeWeight = available.reduce((total, factor) => total + factor.weight, 0);
  const rawScore = activeWeight ? available.reduce((total, factor) => total + (factor.edge ?? 0) * factor.weight / activeWeight, 0) : 0;
  const effectiveGames = Math.min(left.effectiveGames, right.effectiveGames);
  const sampleConfidence = Math.min(1, effectiveGames / 25);
  const rosterConfidence = Math.min(1, Math.min(left.rosterGames, right.rosterGames) / 25);
  const patchConfidence = Math.min(1, Math.min(left.patchPlayerGames, right.patchPlayerGames) / 15);
  const confidence = Math.min(1, activeWeight * sampleConfidence * (0.7 + 0.2 * rosterConfidence + 0.1 * patchConfidence));
  const calibratedScore = rawScore * 2.1 * Math.max(0.4, confidence);
  const probabilityA = 1 / (1 + Math.exp(-calibratedScore));
  return {
    probabilityA, probabilityB: 1 - probabilityA, factors, activeWeight, confidence,
    mapForecasts: {
      totalKills: mapForecast(left.totalKills, right.totalKills, left.totalKillsDeviation, right.totalKillsDeviation, killsLine, 4),
      duration: mapForecast(left.durationMinutes, right.durationMinutes, left.durationDeviation, right.durationDeviation, durationLine, 3),
    },
  };
}
