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

export function profileValorantTeam(id: number, name: string, maps: ValorantMap[], roster: string[], now = new Date()): ValorantProfile {
  const weighted = maps.map((map) => [map, weightFor(map.playedAt, now)] as const);
  const metric = (pick: (map: ValorantMap) => number | null) => average(weighted.map(([map, weight]) => [pick(map), weight]));
  const recent = maps.filter((map) => ageDays(map.playedAt, now) <= 35);
  return {
    id, name, maps: maps.length, effectiveMaps: weighted.reduce((sum, [, weight]) => sum + weight, 0),
    winRate: metric((map) => map.won), recentWinRate: recent.length ? recent.reduce((sum, map) => sum + map.won, 0) / recent.length : null,
    roundDiff: metric((map) => map.roundsFor === null || map.roundsAgainst === null ? null : map.roundsFor - map.roundsAgainst),
    acs: metric((map) => map.acs),
    kda: metric((map) => map.kills === null || map.deaths === null || map.assists === null ? null : (map.kills + map.assists) / Math.max(1, map.deaths)),
    openingDiff: metric((map) => map.firstKills === null || map.firstDeaths === null ? null : map.firstKills - map.firstDeaths),
    roster, lastMapAt: maps.map((map) => map.playedAt).sort().at(-1) ?? null,
  };
}

export function predictValorant(left: ValorantProfile, right: ValorantProfile) {
  const factors = [
    ["Recency-weighted map win rate", edge(left.winRate, right.winRate, 0.20), 0.34],
    ["Recent 35-day form", edge(left.recentWinRate, right.recentWinRate, 0.25), 0.20],
    ["Round differential", edge(left.roundDiff, right.roundDiff, 4), 0.18],
    ["Average combat score", edge(left.acs, right.acs, 35), 0.13],
    ["Team KDA", edge(left.kda, right.kda, 0.45), 0.08],
    ["First-kill differential", edge(left.openingDiff, right.openingDiff, 2.5), 0.07],
  ].map(([name, value, weight]) => ({ name: name as string, edge: value as number | null, weight: weight as number }));
  const available = factors.filter((factor) => factor.edge !== null);
  const activeWeight = available.reduce((sum, factor) => sum + factor.weight, 0);
  const raw = activeWeight ? available.reduce((sum, factor) => sum + (factor.edge ?? 0) * factor.weight / activeWeight, 0) : 0;
  const coverage = Math.min(1, Math.min(left.effectiveMaps, right.effectiveMaps) / 25);
  const probabilityA = 1 / (1 + Math.exp(-(raw * 2.2 * Math.max(0.45, coverage))));
  return { probabilityA, probabilityB: 1 - probabilityA, factors, activeWeight, confidence: coverage };
}
