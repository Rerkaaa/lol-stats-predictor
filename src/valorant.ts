export type ValorantMap = {
  playedAt: string;
  mapName: string;
  won: number;
  roundsFor: number | null;
  roundsAgainst: number | null;
  acs: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  firstKills: number | null;
  firstDeaths: number | null;
};

export type ValorantProfile = {
  id: number;
  name: string;
  maps: number;
  effectiveMaps: number;
  winRate: number | null;
  recentWinRate: number | null;
  roundDiff: number | null;
  acs: number | null;
  kda: number | null;
  openingDiff: number | null;
  totalRounds: number | null;
  totalRoundsDeviation: number | null;
  roster: string[];
  lastMapAt: string | null;
};

const DAY = 86_400_000;
const valid = (value: number | null | undefined) => value !== null && value !== undefined && Number.isFinite(value);
const average = (values: Array<[number | null, number]>) => {
  let total = 0, weight = 0;
  for (const [value, itemWeight] of values) if (valid(value) && itemWeight > 0) { total += value! * itemWeight; weight += itemWeight; }
  return weight ? total / weight : null;
};
const ageDays = (date: string, now: Date) => {
  const normalized = date.endsWith("Z") ? date : `${date.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? Math.max(0, (now.getTime() - timestamp) / DAY) : 365;
};
const weightFor = (date: string, now: Date) => Math.max(0.08, 0.5 ** (ageDays(date, now) / 45));
const edge = (left: number | null, right: number | null, scale: number) => left === null || right === null ? null : Math.max(-1, Math.min(1, (left - right) / scale));
const distribution = (values: Array<[number | null, number]>) => {
  const mean = average(values);
  if (mean === null) return { mean: null, deviation: null };
  let total = 0, weight = 0;
  for (const [value, itemWeight] of values) if (valid(value) && itemWeight > 0) { total += (value! - mean) ** 2 * itemWeight; weight += itemWeight; }
  return { mean, deviation: weight ? Math.sqrt(total / weight) : null };
};
const normalCdf = (value: number) => {
  const sign = value < 0 ? -1 : 1, z = Math.abs(value) / Math.sqrt(2), t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z));
  return 0.5 * (1 + sign * erf);
};
const binomial = (n: number, k: number) => {
  let value = 1;
  for (let index = 1; index <= k; index++) value = value * (n - k + index) / index;
  return value;
};
const seriesWinChance = (mapChance: number, bestOf: number) => {
  const maps = bestOf === 5 ? 5 : bestOf === 1 ? 1 : 3;
  const needed = Math.floor(maps / 2) + 1;
  let chance = 0;
  for (let wins = needed; wins <= maps; wins++) chance += binomial(maps, wins) * mapChance ** wins * (1 - mapChance) ** (maps - wins);
  return chance;
};

export function profileValorantTeam(id: number, name: string, maps: ValorantMap[], roster: string[], now = new Date()): ValorantProfile {
  const weighted = maps.map((map) => [map, weightFor(map.playedAt, now)] as const);
  const metric = (pick: (map: ValorantMap) => number | null) => average(weighted.map(([map, weight]) => [pick(map), weight]));
  const recent = maps.filter((map) => ageDays(map.playedAt, now) <= 35);
  const rounds = distribution(weighted.map(([map, weight]) => [map.roundsFor === null || map.roundsAgainst === null ? null : map.roundsFor + map.roundsAgainst, weight]));
  return {
    id, name, maps: maps.length, effectiveMaps: weighted.reduce((sum, [, weight]) => sum + weight, 0),
    winRate: metric((map) => map.won), recentWinRate: recent.length ? recent.reduce((sum, map) => sum + map.won, 0) / recent.length : null,
    roundDiff: metric((map) => map.roundsFor === null || map.roundsAgainst === null ? null : map.roundsFor - map.roundsAgainst),
    acs: metric((map) => map.acs),
    kda: metric((map) => map.kills === null || map.deaths === null || map.assists === null ? null : (map.kills + map.assists) / Math.max(1, map.deaths)),
    openingDiff: metric((map) => map.firstKills === null || map.firstDeaths === null ? null : map.firstKills - map.firstDeaths),
    totalRounds: rounds.mean, totalRoundsDeviation: rounds.deviation,
    roster, lastMapAt: maps.map((map) => map.playedAt).sort().at(-1) ?? null,
  };
}

export function predictValorant(left: ValorantProfile, right: ValorantProfile, roundsLine: number | null = null, bestOf = 3) {
  const factors = [
    ["Recency-weighted map win rate", edge(left.winRate, right.winRate, 0.20), 0.48],
    ["Round differential", edge(left.roundDiff, right.roundDiff, 4), 0.37],
    ["Recent 35-day form", edge(left.recentWinRate, right.recentWinRate, 0.25), 0.15],
  ].map(([name, value, weight]) => ({ name: name as string, edge: value as number | null, weight: weight as number }));
  const available = factors.filter((factor) => factor.edge !== null);
  const activeWeight = available.reduce((sum, factor) => sum + factor.weight, 0);
  const raw = activeWeight ? available.reduce((sum, factor) => sum + (factor.edge ?? 0) * factor.weight / activeWeight, 0) : 0;
  const coverage = Math.min(1, Math.min(left.effectiveMaps, right.effectiveMaps) / 25);
  // Rolling 2025–2026 replay calibration: a conservative scale reduced Brier error
  // versus the previously overconfident raw model.
  const probabilityA = 1 / (1 + Math.exp(-(raw * 0.9 * Math.max(0.45, coverage))));
  const expectedRounds = left.totalRounds === null || right.totalRounds === null ? null : (left.totalRounds + right.totalRounds) / 2;
  const roundsDeviation = expectedRounds === null ? null : Math.max(2.4, Math.sqrt(((left.totalRoundsDeviation ?? 2.4) ** 2 + (right.totalRoundsDeviation ?? 2.4) ** 2) / 2));
  const probabilityOver = expectedRounds === null || roundsDeviation === null || roundsLine === null ? null : 1 - normalCdf((roundsLine - expectedRounds) / roundsDeviation);
  const seriesProbabilityA = seriesWinChance(probabilityA, bestOf);
  return { probabilityA, probabilityB: 1 - probabilityA, seriesProbabilityA, seriesProbabilityB: 1 - seriesProbabilityA, bestOf, factors, activeWeight, confidence: coverage, roundsForecast: expectedRounds === null || roundsDeviation === null ? null : { expected: expectedRounds, typicalLow: expectedRounds - .67449 * roundsDeviation, typicalHigh: expectedRounds + .67449 * roundsDeviation, line: roundsLine, probabilityOverLine: probabilityOver, probabilityUnderLine: probabilityOver === null ? null : 1 - probabilityOver } };
}
