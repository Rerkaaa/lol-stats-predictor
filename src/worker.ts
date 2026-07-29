import { ingestOracleGames } from "./oracle-ingest";
import type { OracleGamePayload } from "./oracle";
import { predictTimeAware, profileTeam, type PlayerGame, type RosterPlayer, type TeamGame } from "./prediction";
import { opponentAdjustedElo, type EloMatch } from "./elo";
import { predictValorant, profileValorantTeam, type ValorantMap } from "./valorant";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  IMPORT_TOKEN?: string;
  VALORANT_IMPORT_TOKEN?: string;
  RIOT_API_KEY?: string;
}

type TeamRow = { id: number; name: string };
type RosterDbRow = { name: string; role: string | null; games: number };
type TeamGameDbRow = Omit<TeamGame, "rosterOverlap">;
type PlayerGameDbRow = PlayerGame & { matchId: number; playerName: string };
type RecentMapRow = {
  matchId: number; playedAt: string | null; stage: string | null; patch: string | null; durationSeconds: number | null;
  blueTeamId: number; blueTeam: string; redTeamId: number; redTeam: string; winnerTeamId: number | null;
  blueKills: number | null; redKills: number | null; blueDragons: number | null; redDragons: number | null;
  blueBarons: number | null; redBarons: number | null; blueTowers: number | null; redTowers: number | null;
};
type RecentPlayerRow = { matchId: number; teamId: number; playerName: string; role: string | null; champion: string | null; kills: number | null; deaths: number | null; assists: number | null; cs: number | null; gold: number | null; damage: number | null; visionScore: number | null };
type RiotAccount = { puuid: string; gameName: string; tagLine: string };
type RiotSummoner = { id: string; profileIconId: number; summonerLevel: number };
type RiotLeagueEntry = { queueType: string; tier: string; rank: string; leaguePoints: number; wins: number; losses: number };
type RiotLeagueList = { entries: Array<{ summonerId: string; leaguePoints: number; wins: number; losses: number }> };
type RiotMatch = { metadata: { matchId: string }; info: { gameCreation: number; gameDuration: number; gameMode: string; queueId: number; participants: Array<{ puuid: string; teamId: number; championName: string; championId: number; kills: number; deaths: number; assists: number; win: boolean; totalMinionsKilled: number; neutralMinionsKilled: number; teamPosition: string; goldEarned: number; totalDamageDealtToChampions: number; visionScore: number; wardsPlaced: number; wardsKilled: number; item0: number; item1: number; item2: number; item3: number; item4: number; item5: number; item6: number }> } };
type RiotMastery = { championId: number; championPoints: number; lastPlayTime: number };
type DataDragonChampion = { key: string; name: string; id: string };
type RankSnapshot = { seasonYear: number; tier: string | null; division: string | null; leaguePoints: number | null; wins: number | null; losses: number | null; capturedAt: string };

type StartImportBody = { year?: number; sourceUrl?: string; sourceHash?: string };
type ChangedGamesBody = StartImportBody & { games?: Array<{ gameId?: string; sourceHash?: string }> };
type GamesBody = StartImportBody & { games?: OracleGamePayload[] };
type ValorantPlayerPayload = { name: string; agent?: string; rating?: number; acs?: number; adr?: number; kills?: number; deaths?: number; assists?: number; headshotPercent?: number; firstKills?: number; firstDeaths?: number };
type ValorantMapPayload = { number: number; name: string; durationSeconds?: number; teamAScore?: number; teamBScore?: number; winner?: "A" | "B"; players?: Array<ValorantPlayerPayload & { team: "A" | "B" }> };
type ValorantSeriesPayload = { id: string; url?: string; event?: string; tier?: string; playedAt: string; bestOf?: number; patch?: string; teamA: string; teamB: string; teamAScore?: number; teamBScore?: number; winner?: "A" | "B"; maps: ValorantMapPayload[] };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const validStart = (body: StartImportBody) => Number.isInteger(body.year) && (body.year as number) >= 2020 && typeof body.sourceUrl === "string" && body.sourceUrl.length > 0 && validHash(body.sourceHash);

const authorized = (request: Request, env: Env) =>
  !!env.IMPORT_TOKEN && request.headers.get("authorization") === `Bearer ${env.IMPORT_TOKEN}`;

const riotRouting = {
  BR1: ["br1", "americas"], LA1: ["la1", "americas"], LA2: ["la2", "americas"], NA1: ["na1", "americas"],
  EUW1: ["euw1", "europe"], EUN1: ["eun1", "europe"], TR1: ["tr1", "europe"], RU: ["ru", "europe"],
  JP1: ["jp1", "asia"], KR: ["kr", "asia"], OC1: ["oc1", "sea"], PH2: ["ph2", "sea"], SG2: ["sg2", "sea"], TH2: ["th2", "sea"], TW2: ["tw2", "sea"], VN2: ["vn2", "sea"],
} as const;
type RiotRegion = keyof typeof riotRouting;

class RiotApiError extends Error {
  constructor(readonly status: number) { super(`Riot API request failed with ${status}`); }
}

async function riotFetch<T>(url: string, apiKey: string) {
  const response = await fetch(url, { headers: { "X-Riot-Token": apiKey } });
  if (!response.ok) throw new RiotApiError(response.status);
  return response.json<T>();
}

async function dataDragonVersion() {
  const response = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
  if (!response.ok) return null;
  const versions = await response.json<string[]>();
  return versions[0] ?? null;
}

async function apexLadderPosition(platform: string, summonerId: string, tier: string, apiKey: string) {
  const endpoint = tier === "CHALLENGER" ? "challengerleagues" : tier === "GRANDMASTER" ? "grandmasterleagues" : "masterleagues";
  const ladder = await riotFetch<RiotLeagueList>(`https://${platform}.api.riotgames.com/lol/league/v4/${endpoint}/by-queue/RANKED_SOLO_5x5`, apiKey);
  const entries = [...ladder.entries].sort((left, right) => right.leaguePoints - left.leaguePoints || right.wins - left.wins || left.losses - right.losses);
  const position = entries.findIndex((entry) => entry.summonerId === summonerId);
  if (position < 0) return null;
  return { position: position + 1, total: entries.length, topPercent: ((position + 1) / Math.max(1, entries.length)) * 100 };
}

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function detailsInBatches(ids: string[], routing: string, apiKey: string) {
  const details: RiotMatch[] = [];
  for (const id of ids) {
    details.push(await riotFetch<RiotMatch>(`https://${routing}.api.riotgames.com/lol/match/v5/matches/${id}`, apiKey));
    await pause(90);
  }
  return details;
}

function riotError(error: unknown) {
  if (error instanceof RiotApiError) {
    if (error.status === 404) return ["That Riot ID was not found in the selected region.", 404] as const;
    if (error.status === 429) return ["Riot's API rate limit was reached. Please try again in a moment.", 429] as const;
    if (error.status === 401 || error.status === 403) return ["The Riot API key is unavailable or has expired. Add a new key and try again.", 503] as const;
  }
  return ["Riot data is temporarily unavailable. Please try again.", 502] as const;
}

async function summonerLookup(request: Request, env: Env, url: URL) {
  if (!env.RIOT_API_KEY) return json({ error: "Riot API is not configured yet." }, 503);
  const gameName = url.searchParams.get("gameName")?.trim() ?? "";
  const tagLine = url.searchParams.get("tagLine")?.trim() ?? "";
  const region = url.searchParams.get("region")?.toUpperCase() as RiotRegion;
  if (!gameName || !tagLine || gameName.length > 30 || tagLine.length > 10 || !(region in riotRouting)) return json({ error: "Enter a Riot ID, tag, and supported region." }, 400);
  const lookupKey = `${region}:${gameName.toLocaleLowerCase()}:${tagLine.toLocaleLowerCase()}`;
  const refresh = url.searchParams.get("refresh") === "1";
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") ?? "20") || 20));
  const stored = await env.DB.prepare("SELECT payload_json FROM summoner_lookup_cache WHERE lookup_key=?").bind(lookupKey).first<{ payload_json: string }>();
  const storedData = stored ? JSON.parse(stored.payload_json) as { matches?: Array<Record<string, any>>; historyComplete?: boolean } : null;
  if (!refresh && storedData) {
    const allMatches = storedData.matches ?? [];
    return json({ ...storedData, matches: allMatches.slice(offset, offset + limit), storedGames: allMatches.length, historyPage: { offset, limit, total: allMatches.length } });
  }
  const [platform, routing] = riotRouting[region];
  const encodedName = encodeURIComponent(gameName), encodedTag = encodeURIComponent(tagLine);
  try {
    const account = await riotFetch<RiotAccount>(`https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodedName}/${encodedTag}`, env.RIOT_API_KEY);
    const storedMatches = storedData?.matches ?? [];
    const storedById = new Map(storedMatches.map((match) => [String(match.id), match]));
    const olderStart = storedMatches.length;
    const [summoner, leagues, latestIds, olderIds, mastery] = await Promise.all([
      riotFetch<RiotSummoner>(`https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}`, env.RIOT_API_KEY),
      riotFetch<RiotLeagueEntry[]>(`https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${account.puuid}`, env.RIOT_API_KEY),
      riotFetch<string[]>(`https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?start=0&count=20`, env.RIOT_API_KEY),
      olderStart >= 20 && !storedData?.historyComplete ? riotFetch<string[]>(`https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?start=${olderStart}&count=20`, env.RIOT_API_KEY) : Promise.resolve([]),
      riotFetch<RiotMastery[]>(`https://${platform}.api.riotgames.com/lol/champion-mastery/v4/player/${account.puuid}/top?count=5`, env.RIOT_API_KEY).catch((error) => error instanceof RiotApiError && error.status === 403 ? null : Promise.reject(error)),
    ]);
    const latestNeedingDetails = latestIds.filter((id) => storedById.get(id)?.gold == null);
    const olderNewIds = olderIds.filter((id) => !storedById.has(id));
    const matchIds = [...new Set([...latestNeedingDetails, ...olderNewIds])];
    const [matches, version] = await Promise.all([
      detailsInBatches(matchIds, routing, env.RIOT_API_KEY),
      dataDragonVersion().catch(() => null),
    ]);
    const [championData, itemData] = version ? await Promise.all([
      fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`).then((response) => response.ok ? response.json<{ data: Record<string, DataDragonChampion> }>() : null).catch(() => null),
      fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`).then((response) => response.ok ? response.json<{ data: Record<string, { name: string }> }>() : null).catch(() => null),
    ]) : [null, null];
    const championsById = new Map(Object.values(championData?.data ?? {}).map((champion) => [Number(champion.key), champion]));
    const solo = leagues.find((entry) => entry.queueType === "RANKED_SOLO_5x5");
    const ladder = solo && ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(solo.tier)
      ? await apexLadderPosition(platform, summoner.id, solo.tier, env.RIOT_API_KEY).catch(() => null)
      : null;
    const updatedAt = new Date().toISOString();
    const data = {
      profile: { gameName: account.gameName, tagLine: account.tagLine, summonerLevel: summoner.summonerLevel, profileIconId: summoner.profileIconId, region },
      updatedAt,
      rank: solo ? { tier: solo.tier, rank: solo.rank, leaguePoints: solo.leaguePoints, wins: solo.wins, losses: solo.losses } : null,
      ladder,
      dataDragonVersion: version,
      masteryAvailable: mastery !== null,
      mastery: (mastery ?? []).map((entry) => {
        const champion = championsById.get(entry.championId);
        return { champion: champion?.name === "Wukong" ? "Wukong" : champion?.name ?? "Unknown champion", championAsset: champion?.id ?? "", points: entry.championPoints, lastPlayedAt: new Date(entry.lastPlayTime).toISOString() };
      }),
      matches: [...matches.map((match) => {
        const player = match.info.participants.find((participant) => participant.puuid === account.puuid);
        if (!player) return null;
        const teamKills = match.info.participants.filter((participant) => participant.teamId === player.teamId).reduce((total, participant) => total + participant.kills, 0);
        const itemIds = [player.item0, player.item1, player.item2, player.item3, player.item4, player.item5, player.item6].filter((id) => id > 0);
        return { id: match.metadata.matchId, champion: player.championName === "MonkeyKing" ? "Wukong" : player.championName, championAsset: player.championName, kills: player.kills, deaths: player.deaths, assists: player.assists, killParticipation: teamKills ? (player.kills + player.assists) / teamKills : null, win: player.win, cs: player.totalMinionsKilled + player.neutralMinionsKilled, role: player.teamPosition || "-", durationSeconds: match.info.gameDuration, queueId: match.info.queueId, gameMode: match.info.gameMode, playedAt: new Date(match.info.gameCreation).toISOString(), gold: player.goldEarned, damage: player.totalDamageDealtToChampions, vision: player.visionScore, wardsPlaced: player.wardsPlaced, wardsKilled: player.wardsKilled, items: itemIds.map((id) => ({ id, name: itemData?.data[String(id)]?.name ?? `Item ${id}` })) };
      }).filter((match): match is NonNullable<typeof match> => match !== null), ...storedMatches.filter((match) => !matchIds.includes(String(match.id)))].sort((left, right) => String(right.playedAt).localeCompare(String(left.playedAt))),
      historyComplete: storedData?.historyComplete === true || (olderStart >= 20 && olderIds.length < 20),
    };
    if (solo) {
      await env.DB.prepare(
        "INSERT INTO summoner_rank_snapshots(lookup_key,season_year,tier,division,league_points,wins,losses,captured_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(lookupKey, new Date().getUTCFullYear(), solo.tier, solo.rank, solo.leaguePoints, solo.wins, solo.losses, updatedAt).run();
    }
    const { results: snapshotRows = [] } = await env.DB.prepare(
      "SELECT season_year seasonYear,tier,division,league_points leaguePoints,wins,losses,captured_at capturedAt FROM summoner_rank_snapshots WHERE lookup_key=? ORDER BY captured_at DESC",
    ).bind(lookupKey).all<RankSnapshot>();
    const tierScore: Record<string, number> = { IRON: 0, BRONZE: 1000, SILVER: 2000, GOLD: 3000, PLATINUM: 4000, EMERALD: 5000, DIAMOND: 6000, MASTER: 7000, GRANDMASTER: 8000, CHALLENGER: 9000 };
    const divisionScore: Record<string, number> = { IV: 0, III: 100, II: 200, I: 300 };
    const score = (row: RankSnapshot) => (tierScore[row.tier ?? ""] ?? -1) + (divisionScore[row.division ?? ""] ?? 0) + (row.leaguePoints ?? 0);
    const currentYear = new Date().getUTCFullYear();
    const currentSnapshots = snapshotRows.filter((row) => row.seasonYear === currentYear);
    const peakRank = [...currentSnapshots].sort((left, right) => score(right) - score(left))[0] ?? null;
    const seasonHistory = [...new Map(snapshotRows.map((row) => [row.seasonYear, row])).values()].slice(0, 5);
    Object.assign(data, { peakRank, seasonHistory, storedGames: data.matches.length });
    await env.DB.prepare(
      `INSERT INTO summoner_lookup_cache(lookup_key,region,game_name,tag_line,payload_json,updated_at)
       VALUES(?,?,?,?,?,?) ON CONFLICT(lookup_key) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at`,
    ).bind(lookupKey, region, account.gameName, account.tagLine, JSON.stringify(data), updatedAt).run();
    const response = json({ ...data, matches: data.matches.slice(offset, offset + limit), storedGames: data.matches.length, historyPage: { offset, limit, total: data.matches.length } });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    const [message, status] = riotError(error);
    return json({ error: message }, status);
  }
}

async function fullMatchDetails(env: Env, url: URL) {
  if (!env.RIOT_API_KEY) return json({ error: "Riot API is not configured yet." }, 503);
  const region = url.searchParams.get("region")?.toUpperCase() as RiotRegion;
  const matchId = url.searchParams.get("matchId") ?? "";
  if (!(region in riotRouting) || !/^[A-Za-z0-9_:-]+$/.test(matchId)) return json({ error: "Invalid match request." }, 400);
  const cached = await env.DB.prepare("SELECT payload_json FROM riot_match_detail_cache WHERE match_id=?").bind(matchId).first<{ payload_json: string }>();
  if (cached) {
    const payload = JSON.parse(cached.payload_json);
    if (payload.timelinePlayers && payload.itemEvents && payload.objectiveEvents && payload.players?.[0]?.runes?.[0]?.description) return json(payload);
  }
  const [platform, routing] = riotRouting[region];
  try {
    const [match, timeline, version] = await Promise.all([
      riotFetch<any>(`https://${routing}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`, env.RIOT_API_KEY),
      riotFetch<any>(`https://${routing}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`, env.RIOT_API_KEY),
      dataDragonVersion().catch(() => null),
    ]);
    const [itemData, runeData] = version ? await Promise.all([
      fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`).then((response) => response.ok ? response.json<any>() : null).catch(() => null),
      fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/runesReforged.json`).then((response) => response.ok ? response.json<any[]>() : null).catch(() => null),
    ]) : [null, null];
    const runeMap = new Map<number, any>();
    (runeData ?? []).forEach((tree: any) => tree.slots?.forEach((slot: any) => slot.runes?.forEach((rune: any) => runeMap.set(rune.id, rune))));
    const players = match.info.participants.map((player: any) => {
      const itemIds = [player.item0, player.item1, player.item2, player.item3, player.item4, player.item5, player.item6].filter((id: number) => id > 0);
      const runeIds = player.perks?.styles?.flatMap((style: any) => style.selections?.map((selection: any) => selection.perk) ?? []) ?? [];
      return { participantId: player.participantId, teamId: player.teamId, champion: player.championName === "MonkeyKing" ? "Wukong" : player.championName, championAsset: player.championName, summoner: player.riotIdGameName ? `${player.riotIdGameName}#${player.riotIdTagline ?? ""}` : player.summonerName, role: player.teamPosition || "-", win: player.win, kills: player.kills, deaths: player.deaths, assists: player.assists, gold: player.goldEarned, damage: player.totalDamageDealtToChampions, damageTaken: player.totalDamageTaken, vision: player.visionScore, wardsPlaced: player.wardsPlaced, wardsKilled: player.wardsKilled, cs: player.totalMinionsKilled + player.neutralMinionsKilled, items: itemIds.map((id: number) => ({ id, name: itemData?.data?.[String(id)]?.name ?? `Item ${id}` })), runes: runeIds.map((id: number) => ({ id, name: runeMap.get(id)?.name ?? `Rune ${id}`, icon: runeMap.get(id)?.icon ?? "", description: runeMap.get(id)?.longDesc ?? runeMap.get(id)?.shortDesc ?? "No description available." })) };
    });
    const timelineFrames = (timeline.info.frames ?? []).map((frame: any) => {
      const values = Object.values(frame.participantFrames ?? {}) as any[];
      const blue = values.filter((value) => Number(value.participantId) <= 5), red = values.filter((value) => Number(value.participantId) > 5);
      const sum = (rows: any[], field: string) => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
      return { minute: Math.round((frame.timestamp || 0) / 60000), blue: { gold: sum(blue, "totalGold"), xp: sum(blue, "xp"), cs: sum(blue, "minionsKilled") + sum(blue, "jungleMinionsKilled") }, red: { gold: sum(red, "totalGold"), xp: sum(red, "xp"), cs: sum(red, "minionsKilled") + sum(red, "jungleMinionsKilled") } };
    });
    const timelinePlayers = (timeline.info.frames ?? []).map((frame: any) => ({ minute: Math.round((frame.timestamp || 0) / 60000), players: Object.values(frame.participantFrames ?? {}).map((value: any) => ({ participantId: Number(value.participantId), gold: Number(value.totalGold) || 0, xp: Number(value.xp) || 0, cs: (Number(value.minionsKilled) || 0) + (Number(value.jungleMinionsKilled) || 0) })) }));
    const itemEvents = (timeline.info.frames ?? []).flatMap((frame: any) => (frame.events ?? []).filter((event: any) => ["ITEM_PURCHASED", "ITEM_SOLD", "ITEM_UNDO"].includes(event.type)).map((event: any) => ({ participantId: Number(event.participantId), minute: Math.round((event.timestamp || 0) / 60000), type: event.type, itemId: Number(event.itemId), itemName: itemData?.data?.[String(event.itemId)]?.name ?? `Item ${event.itemId}` })));
    const objectiveEvents = (timeline.info.frames ?? []).flatMap((frame: any) => (frame.events ?? []).filter((event: any) => event.type === "ELITE_MONSTER_KILL" || event.type === "BUILDING_KILL").map((event: any) => ({ minute: Math.round((event.timestamp || 0) / 60000), teamId: Number(event.killerTeamId) || (Number(event.killerId) <= 5 ? 100 : 200), label: event.type === "ELITE_MONSTER_KILL" ? event.monsterType : event.buildingType === "TOWER_BUILDING" ? "Tower" : "Inhibitor" })));
    const payload = { matchId, version, duration: match.info.gameDuration, queueId: match.info.queueId, gameMode: match.info.gameMode, playedAt: new Date(match.info.gameCreation).toISOString(), players, timeline: timelineFrames, timelinePlayers, itemEvents, objectiveEvents };
    await env.DB.prepare("INSERT INTO riot_match_detail_cache(match_id,region,payload_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(match_id) DO UPDATE SET region=excluded.region,payload_json=excluded.payload_json,updated_at=excluded.updated_at").bind(matchId, region, JSON.stringify(payload), new Date().toISOString()).run();
    return json(payload);
  } catch (error) {
    const [message, status] = riotError(error);
    return json({ error: message }, status);
  }
}

async function currentPatch(db: D1Database) {
  return db.prepare("SELECT patch,played_at playedAt FROM matches WHERE source_game_id LIKE 'oracle:%' AND played_at>='2022-01-01' AND patch IS NOT NULL AND patch<>'' ORDER BY played_at DESC LIMIT 1").first<{ patch: string; playedAt: string | null }>();
}

async function lolEloSignal(db: D1Database, leftId: number, rightId: number) {
  const { results = [] } = await db.prepare(
    `SELECT m.id matchId,m.played_at playedAt,s.team_id teamId,s.won
     FROM matches m JOIN team_game_stats s ON s.match_id=m.id
     WHERE m.source_game_id LIKE 'oracle:%' AND m.played_at>='2022-01-01'
     ORDER BY m.played_at,m.id`,
  ).all<EloMatch>();
  return opponentAdjustedElo(results, leftId, rightId);
}

async function teamProfile(db: D1Database, id: number, patch: string | null, referenceDate: Date, expectedLineup: string[] = []) {
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
  const confirmedLineup = expectedLineup.length === 5;
  const activeNames = confirmedLineup ? expectedLineup : roster.map((player) => player.name);
  const { results: gameRows = [] } = await db
    .prepare(
      `SELECT s.match_id matchId,m.played_at playedAt,m.stage,m.patch,s.side,s.won,s.kills,s.deaths,s.assists,
        m.duration_seconds durationSeconds,s.gold_diff_15 goldDiff15,s.xp_diff_15 xpDiff15,s.cs_diff_15 csDiff15,s.first_blood firstBlood,
        s.first_tower firstTower,s.dragons,s.barons,s.vision_score_per_minute vision
       FROM team_game_stats s JOIN matches m ON m.id=s.match_id WHERE s.team_id=? AND m.source_game_id LIKE 'oracle:%' AND m.played_at>='2022-01-01' ORDER BY m.played_at DESC`,
    )
    .bind(id)
    .all<TeamGameDbRow>();
  if (!gameRows.length) return null;
  const playerStatement = activeNames.length
    ? db.prepare(
        `SELECT p.match_id matchId,p.player_name playerName,m.played_at playedAt,m.patch,s.won,p.kills,p.deaths,p.assists,p.champion
         FROM player_game_stats p JOIN matches m ON m.id=p.match_id JOIN team_game_stats s ON s.match_id=p.match_id AND s.team_id=p.team_id
         WHERE p.team_id=? AND p.player_name IN (${activeNames.map(() => "?").join(",")}) AND m.source_game_id LIKE 'oracle:%' AND m.played_at>='2022-01-01'`,
      ).bind(id, ...activeNames)
    : db.prepare("SELECT NULL matchId,NULL playerName,NULL playedAt,NULL patch,NULL won,NULL kills,NULL deaths,NULL assists,NULL champion WHERE 0");
  const { results: playerRows = [] } = await playerStatement.all<PlayerGameDbRow>();
  const rosterByMatch = new Map<number, Set<string>>();
  for (const row of playerRows) {
    const players = rosterByMatch.get(row.matchId) ?? new Set<string>();
    players.add(row.playerName);
    rosterByMatch.set(row.matchId, players);
  }
  const games: TeamGame[] = gameRows.map((row) => ({ ...row, rosterOverlap: rosterByMatch.get(row.matchId)?.size ?? 0 }));
  const playerGames: PlayerGame[] = playerRows.map(({ matchId: _matchId, ...row }) => row);
  return profileTeam(team.id, team.name, games, roster, playerGames, patch, confirmedLineup, referenceDate);
}

async function teamRoster(db: D1Database, id: number) {
  const { results = [] } = await db.prepare(
    `SELECT p.player_name name,MAX(p.role) role,COUNT(*) games
     FROM player_game_stats p JOIN matches m ON m.id=p.match_id
     WHERE p.team_id=? AND m.source_game_id LIKE 'oracle:%' AND m.played_at>='2022-01-01'
     GROUP BY p.player_name ORDER BY MAX(m.played_at) DESC,COUNT(*) DESC LIMIT 8`,
  ).bind(id).all<RosterDbRow>();
  return results.map((row) => ({ name: row.name, role: row.role, games: Number(row.games) }));
}

const parseLineup = (value: string | null) => [...new Set((value ?? "").split(",").map((name) => name.trim()).filter(Boolean))].slice(0, 5);
const lineupConfirmation = (profile: Awaited<ReturnType<typeof teamProfile>>, expected: string[]) => {
  const active = profile?.roster.map((player) => player.name) ?? [];
  const activeKeys = new Set(active.map((name) => name.toLocaleLowerCase()));
  const matched = expected.filter((name) => activeKeys.has(name.toLocaleLowerCase()));
  return { active, expected, matched, confirmed: expected.length === 5 && matched.length === 5 };
};

type SeriesFilter = { teamId?: number; opponentId?: number };

async function latestSeries(db: D1Database, filter: SeriesFilter = {}) {
  const conditions = ["m.source_game_id LIKE 'oracle:%'", "m.played_at>='2022-01-01'"];
  const bindings: number[] = [];
  if (filter.teamId) {
    conditions.push("(m.blue_team_id=? OR m.red_team_id=?)");
    bindings.push(filter.teamId, filter.teamId);
  }
  if (filter.opponentId) {
    conditions.push("(m.blue_team_id=? OR m.red_team_id=?)");
    bindings.push(filter.opponentId, filter.opponentId);
  }
  const statement = db.prepare(
    `SELECT m.id matchId,m.played_at playedAt,m.stage,m.patch,m.duration_seconds durationSeconds,
      m.blue_team_id blueTeamId,blue.name blueTeam,m.red_team_id redTeamId,red.name redTeam,m.winner_team_id winnerTeamId,
      blue_stats.kills blueKills,red_stats.kills redKills,blue_stats.dragons blueDragons,red_stats.dragons redDragons,
      blue_stats.barons blueBarons,red_stats.barons redBarons,blue_stats.towers blueTowers,red_stats.towers redTowers
     FROM matches m JOIN teams blue ON blue.id=m.blue_team_id JOIN teams red ON red.id=m.red_team_id
     LEFT JOIN team_game_stats blue_stats ON blue_stats.match_id=m.id AND blue_stats.team_id=m.blue_team_id
     LEFT JOIN team_game_stats red_stats ON red_stats.match_id=m.id AND red_stats.team_id=m.red_team_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY m.played_at DESC,m.id DESC LIMIT 80`,
  );
  const { results = [] } = await (bindings.length ? statement.bind(...bindings) : statement).all<RecentMapRow>();
  if (!results.length) return [];
  const { results: playerRows = [] } = await db.prepare(
    `SELECT match_id matchId,team_id teamId,player_name playerName,role,champion,kills,deaths,assists,cs,gold,damage,vision_score visionScore
     FROM player_game_stats WHERE match_id IN (${results.map(() => "?").join(",")})
     ORDER BY match_id,team_id,role`,
  ).bind(...results.map((map) => map.matchId)).all<RecentPlayerRow>();
  const playersByMatch = new Map<number, RecentPlayerRow[]>();
  for (const player of playerRows) (playersByMatch.get(player.matchId) ?? playersByMatch.set(player.matchId, []).get(player.matchId)).push(player);
  const groups = new Map<string, RecentMapRow[]>();
  for (const map of results) {
    const date = map.playedAt?.slice(0, 10) ?? "unknown-date";
    const teams = [map.blueTeamId, map.redTeamId].sort((left, right) => left - right).join(":");
    const key = `${date}|${map.stage ?? "Unknown competition"}|${teams}`;
    const series = groups.get(key) ?? [];
    series.push(map);
    groups.set(key, series);
  }
  return [...groups.values()].map((maps) => {
    const chronological = [...maps].sort((left, right) => String(left.playedAt).localeCompare(String(right.playedAt)) || left.matchId - right.matchId);
    const first = chronological[0];
    const scores = new Map<number, number>([[first.blueTeamId, 0], [first.redTeamId, 0]]);
    for (const map of chronological) if (map.winnerTeamId !== null) scores.set(map.winnerTeamId, (scores.get(map.winnerTeamId) ?? 0) + 1);
    return {
      playedAt: chronological.at(-1)?.playedAt ?? null, competition: first.stage ?? "Unknown competition",
      teamA: { name: first.blueTeam, score: scores.get(first.blueTeamId) ?? 0 },
      teamB: { name: first.redTeam, score: scores.get(first.redTeamId) ?? 0 },
      maps: chronological.map((map, index) => ({
        number: index + 1, patch: map.patch, durationSeconds: map.durationSeconds, blueTeam: map.blueTeam, redTeam: map.redTeam,
        blueKills: map.blueKills, redKills: map.redKills, winner: map.winnerTeamId === map.blueTeamId ? map.blueTeam : map.winnerTeamId === map.redTeamId ? map.redTeam : null,
        objectives: { blue: { dragons: map.blueDragons, barons: map.blueBarons, towers: map.blueTowers }, red: { dragons: map.redDragons, barons: map.redBarons, towers: map.redTowers } },
        players: (playersByMatch.get(map.matchId) ?? []).map((player) => ({ ...player, team: player.teamId === map.blueTeamId ? "blue" : "red" })),
      })),
    };
  }).sort((left, right) => String(right.playedAt).localeCompare(String(left.playedAt))).slice(0, 12);
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
  if (pathname === "/api/admin/oracle/known-games") {
    const supplied = (body as { games?: unknown[] }).games;
    if (!Array.isArray(supplied) || supplied.length < 1 || supplied.length > 80 || !supplied.every((game) => typeof game === "string" && game.length > 0 && game.length < 100)) {
      return json({ error: "Expected 1-80 game IDs." }, 400);
    }
    const { results = [] } = await env.DB
      .prepare(`SELECT source_game_id sourceGameId FROM matches WHERE source_game_id IN (${supplied.map(() => "?").join(",")})`)
      .bind(...supplied.map((game) => `oracle:${game}`))
      .all<{ sourceGameId: string }>();
    return json({ knownGameIds: results.map((row) => row.sourceGameId.replace(/^oracle:/, "")) });
  }
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

const valorantAuthorized = (request: Request, env: Env) => {
  const token = env.VALORANT_IMPORT_TOKEN ?? env.IMPORT_TOKEN;
  return !!token && request.headers.get("authorization") === `Bearer ${token}`;
};

async function valorantTeamId(db: D1Database, name: string) {
  const clean = name.trim();
  await db.prepare("INSERT INTO valorant_teams(name) VALUES(?) ON CONFLICT(name) DO NOTHING").bind(clean).run();
  const row = await db.prepare("SELECT id FROM valorant_teams WHERE name=?").bind(clean).first<{ id: number }>();
  if (!row) throw new Error(`Could not save Valorant team ${clean}`);
  return row.id;
}

async function ingestValorantSeries(db: D1Database, series: ValorantSeriesPayload[]) {
  let imported = 0, maps = 0;
  for (const entry of series) {
    const year = new Date(entry.playedAt).getUTCFullYear();
    if (!entry.id || !entry.teamA?.trim() || !entry.teamB?.trim() || !Array.isArray(entry.maps) || !entry.maps.length || ![2025, 2026].includes(year)) continue;
    const [teamAId, teamBId] = await Promise.all([valorantTeamId(db, entry.teamA), valorantTeamId(db, entry.teamB)]);
    const winnerId = entry.winner === "A" ? teamAId : entry.winner === "B" ? teamBId : null;
    await db.prepare(
      `INSERT INTO valorant_series(source_match_id,source_url,event_name,event_tier,played_at,best_of,patch,team_a_id,team_b_id,team_a_score,team_b_score,winner_team_id,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(source_match_id) DO UPDATE SET source_url=excluded.source_url,event_name=excluded.event_name,event_tier=excluded.event_tier,played_at=excluded.played_at,best_of=excluded.best_of,patch=excluded.patch,team_a_id=excluded.team_a_id,team_b_id=excluded.team_b_id,team_a_score=excluded.team_a_score,team_b_score=excluded.team_b_score,winner_team_id=excluded.winner_team_id,updated_at=CURRENT_TIMESTAMP`,
    ).bind(entry.id, entry.url ?? null, entry.event ?? null, entry.tier ?? null, entry.playedAt, entry.bestOf ?? null, entry.patch ?? null, teamAId, teamBId, entry.teamAScore ?? null, entry.teamBScore ?? null, winnerId).run();
    const stored = await db.prepare("SELECT id FROM valorant_series WHERE source_match_id=?").bind(entry.id).first<{ id: number }>();
    if (!stored) throw new Error(`Could not save Valorant series ${entry.id}`);
    imported++;
    for (const map of entry.maps) {
      if (!Number.isInteger(map.number) || !map.name?.trim()) continue;
      const mapWinnerId = map.winner === "A" ? teamAId : map.winner === "B" ? teamBId : null;
      await db.prepare(
        `INSERT INTO valorant_maps(series_id,map_number,map_name,duration_seconds,team_a_score,team_b_score,winner_team_id)
         VALUES(?,?,?,?,?,?,?) ON CONFLICT(series_id,map_number) DO UPDATE SET map_name=excluded.map_name,duration_seconds=excluded.duration_seconds,team_a_score=excluded.team_a_score,team_b_score=excluded.team_b_score,winner_team_id=excluded.winner_team_id`,
      ).bind(stored.id, map.number, map.name, map.durationSeconds ?? null, map.teamAScore ?? null, map.teamBScore ?? null, mapWinnerId).run();
      const savedMap = await db.prepare("SELECT id FROM valorant_maps WHERE series_id=? AND map_number=?").bind(stored.id, map.number).first<{ id: number }>();
      if (!savedMap) continue;
      maps++;
      for (const player of map.players ?? []) {
        const teamId = player.team === "A" ? teamAId : teamBId;
        if (!player.name?.trim()) continue;
        await db.prepare(
          `INSERT INTO valorant_player_maps(map_id,team_id,player_name,agent,rating,acs,adr,kills,deaths,assists,headshot_percent,first_kills,first_deaths)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(map_id,team_id,player_name) DO UPDATE SET agent=excluded.agent,rating=excluded.rating,acs=excluded.acs,adr=excluded.adr,kills=excluded.kills,deaths=excluded.deaths,assists=excluded.assists,headshot_percent=excluded.headshot_percent,first_kills=excluded.first_kills,first_deaths=excluded.first_deaths`,
        ).bind(savedMap.id, teamId, player.name, player.agent ?? null, player.rating ?? null, player.acs ?? null, player.adr ?? null, player.kills ?? null, player.deaths ?? null, player.assists ?? null, player.headshotPercent ?? null, player.firstKills ?? null, player.firstDeaths ?? null).run();
      }
    }
  }
  return { importedSeries: imported, importedMaps: maps };
}

async function valorantProfile(db: D1Database, teamId: number, mapName: string | null = null) {
  const team = await db.prepare("SELECT id,name FROM valorant_teams WHERE id=?").bind(teamId).first<{ id: number; name: string }>();
  if (!team) return null;
  const { results: rows = [] } = await db.prepare(
    `SELECT s.played_at playedAt,m.map_name mapName,CASE WHEN m.winner_team_id=? THEN 1 WHEN m.winner_team_id IS NULL THEN NULL ELSE 0 END won,
      CASE WHEN s.team_a_id=? THEN m.team_a_score ELSE m.team_b_score END roundsFor,CASE WHEN s.team_a_id=? THEN m.team_b_score ELSE m.team_a_score END roundsAgainst,
      AVG(p.acs) acs,AVG(p.adr) adr,SUM(p.kills) kills,SUM(p.deaths) deaths,SUM(p.assists) assists,SUM(p.first_kills) firstKills,SUM(p.first_deaths) firstDeaths
     FROM valorant_maps m JOIN valorant_series s ON s.id=m.series_id LEFT JOIN valorant_player_maps p ON p.map_id=m.id AND p.team_id=?
     WHERE (s.team_a_id=? OR s.team_b_id=?) AND (? IS NULL OR m.map_name=?) GROUP BY m.id ORDER BY s.played_at DESC`,
  ).bind(teamId, teamId, teamId, teamId, teamId, teamId, mapName, mapName).all<ValorantMap>();
  const { results: rosterRows = [] } = await db.prepare(
    `SELECT p.player_name name
     FROM valorant_player_maps p JOIN valorant_maps m ON m.id=p.map_id JOIN valorant_series s ON s.id=m.series_id
     WHERE p.team_id=? AND p.map_id=(SELECT p2.map_id FROM valorant_player_maps p2 JOIN valorant_maps m2 ON m2.id=p2.map_id JOIN valorant_series s2 ON s2.id=m2.series_id WHERE p2.team_id=? ORDER BY s2.played_at DESC,p2.map_id DESC LIMIT 1)
     ORDER BY p.acs DESC`,
  ).bind(teamId, teamId).all<{ name: string }>();
  const continuityRow = await db.prepare(
    `WITH recent_maps AS (
       SELECT m.id FROM valorant_maps m JOIN valorant_series s ON s.id=m.series_id
       WHERE s.team_a_id=? OR s.team_b_id=? ORDER BY s.played_at DESC,m.id DESC LIMIT 8
     ), latest_lineup AS (
       SELECT player_name FROM valorant_player_maps WHERE team_id=? AND map_id=(SELECT id FROM recent_maps LIMIT 1)
     )
     SELECT CASE WHEN (SELECT COUNT(*) FROM recent_maps)=0 OR (SELECT COUNT(*) FROM latest_lineup)=0 THEN NULL
       ELSE 1.0*SUM(CASE WHEN p.player_name IN (SELECT player_name FROM latest_lineup) THEN 1 ELSE 0 END)/((SELECT COUNT(*) FROM recent_maps)*(SELECT COUNT(*) FROM latest_lineup)) END continuity
     FROM valorant_player_maps p WHERE p.team_id=? AND p.map_id IN (SELECT id FROM recent_maps)`,
  ).bind(teamId, teamId, teamId, teamId).first<{ continuity: number | null }>();
  return profileValorantTeam(team.id, team.name, rows, rosterRows.map((row) => row.name), continuityRow?.continuity ?? null);
}

async function handleValorantAdmin(request: Request, env: Env) {
  if (!valorantAuthorized(request, env)) return json({ error: "Unauthorized" }, 401);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await request.json<{ series?: ValorantSeriesPayload[] }>();
    if (!Array.isArray(body.series) || body.series.length !== 1) return json({ error: "Expected exactly one Valorant series." }, 400);
    return json(await ingestValorantSeries(env.DB, body.series));
  } catch (error) {
    return json({ error: "Valorant import failed", detail: errorMessage(error) }, 500);
  }
}

async function valorantMapPool(db: D1Database, teamA: number, teamB: number) {
  const { results = [] } = await db.prepare(
    `SELECT m.map_name name,
      SUM(CASE WHEN s.team_a_id=? OR s.team_b_id=? THEN 1 ELSE 0 END) teamAGames,
      SUM(CASE WHEN m.winner_team_id=? THEN 1 ELSE 0 END) teamAWins,
      AVG(CASE WHEN s.team_a_id=? THEN m.team_a_score-m.team_b_score WHEN s.team_b_id=? THEN m.team_b_score-m.team_a_score END) teamARoundDiff,
      SUM(CASE WHEN s.team_a_id=? OR s.team_b_id=? THEN 1 ELSE 0 END) teamBGames,
      SUM(CASE WHEN m.winner_team_id=? THEN 1 ELSE 0 END) teamBWins,
      AVG(CASE WHEN s.team_a_id=? THEN m.team_a_score-m.team_b_score WHEN s.team_b_id=? THEN m.team_b_score-m.team_a_score END) teamBRoundDiff
     FROM valorant_maps m JOIN valorant_series s ON s.id=m.series_id
     WHERE s.played_at>='2025-01-01' AND (s.team_a_id IN (?,?) OR s.team_b_id IN (?,?))
     GROUP BY m.map_name ORDER BY m.map_name`,
  ).bind(teamA, teamA, teamA, teamA, teamA, teamB, teamB, teamB, teamB, teamB, teamA, teamB, teamA, teamB).all();
  return results;
}

async function valorantHeadToHead(db: D1Database, teamA: number, teamB: number) {
  return db.prepare(
    `SELECT COUNT(*) maps,
      SUM(CASE WHEN m.winner_team_id=? THEN 1 ELSE 0 END) teamAWins,
      SUM(CASE WHEN m.winner_team_id=? THEN 1 ELSE 0 END) teamBWins,
      MAX(s.played_at) latestAt
     FROM valorant_maps m JOIN valorant_series s ON s.id=m.series_id
     WHERE (s.team_a_id=? AND s.team_b_id=?) OR (s.team_a_id=? AND s.team_b_id=?)`,
  ).bind(teamA, teamB, teamA, teamB, teamB, teamA).first<{ maps: number; teamAWins: number; teamBWins: number; latestAt: string | null }>();
}

async function valorantRollingMeta(db: D1Database, teamA: number, teamB: number) {
  const { results: agents = [] } = await db.prepare(
    `WITH latest AS (SELECT MAX(played_at) played_at FROM valorant_series)
     SELECT p.agent,COUNT(*) picks FROM valorant_player_maps p
     JOIN valorant_maps m ON m.id=p.map_id JOIN valorant_series s ON s.id=m.series_id JOIN latest l
     WHERE p.agent IS NOT NULL AND s.played_at>=datetime(l.played_at,'-60 days')
     GROUP BY p.agent ORDER BY picks DESC,p.agent LIMIT 8`,
  ).all<{ agent: string; picks: number }>();
  const { results: teams = [] } = await db.prepare(
    `WITH latest AS (SELECT MAX(played_at) played_at FROM valorant_series)
     SELECT p.team_id teamId,COUNT(DISTINCT p.map_id) maps,COUNT(*) picks FROM valorant_player_maps p
     JOIN valorant_maps m ON m.id=p.map_id JOIN valorant_series s ON s.id=m.series_id JOIN latest l
     WHERE p.team_id IN (?,?) AND s.played_at>=datetime(l.played_at,'-60 days') GROUP BY p.team_id`,
  ).bind(teamA, teamB).all<{ teamId: number; maps: number; picks: number }>();
  const byTeam = new Map(teams.map((row) => [row.teamId, row]));
  const leftMaps = byTeam.get(teamA)?.maps ?? 0, rightMaps = byTeam.get(teamB)?.maps ?? 0;
  return { windowDays: 60, agents, teamA: { maps: leftMaps, picks: byTeam.get(teamA)?.picks ?? 0 }, teamB: { maps: rightMaps, picks: byTeam.get(teamB)?.picks ?? 0 }, coverage: Math.min(1, Math.min(leftMaps, rightMaps) / 10) };
}

const parseValorantDraft = (value: string | null) => [...new Set((value ?? "").split(",").map((agent) => agent.trim()).filter((agent) => agent.length >= 2 && agent.length <= 24))].slice(0, 5);

async function valorantDraftFit(db: D1Database, teamId: number, agents: string[]) {
  if (!agents.length) return null;
  const { results = [] } = await db.prepare(
    `WITH latest AS (SELECT MAX(played_at) played_at FROM valorant_series)
     SELECT p.agent,COUNT(DISTINCT p.map_id) maps,SUM(CASE WHEN m.winner_team_id=p.team_id THEN 1 ELSE 0 END) wins,
       AVG(p.acs) acs,AVG(p.adr) adr
     FROM valorant_player_maps p JOIN valorant_maps m ON m.id=p.map_id JOIN valorant_series s ON s.id=m.series_id JOIN latest l
     WHERE p.team_id=? AND lower(p.agent) IN (${agents.map(() => "?").join(",")}) AND s.played_at>=datetime(l.played_at,'-180 days')
     GROUP BY p.agent ORDER BY p.agent`,
  ).bind(teamId, ...agents.map((agent) => agent.toLowerCase())).all<{ agent: string; maps: number; wins: number; acs: number | null; adr: number | null }>();
  const byAgent = new Map(results.map((row) => [row.agent.toLowerCase(), row]));
  return agents.map((agent) => {
    const row = byAgent.get(agent.toLowerCase());
    return row ? { ...row, winRate: row.maps ? row.wins / row.maps : null } : { agent, maps: 0, wins: 0, acs: null, adr: null, winRate: null };
  });
}

async function valorantPlayerForm(db: D1Database, teamId: number) {
  const { results = [] } = await db.prepare(
    `WITH latest AS (SELECT MAX(played_at) played_at FROM valorant_series), latest_lineup AS (
       SELECT p.player_name FROM valorant_player_maps p JOIN valorant_maps m ON m.id=p.map_id JOIN valorant_series s ON s.id=m.series_id
       WHERE p.team_id=? ORDER BY s.played_at DESC,p.map_id DESC LIMIT 5
     )
     SELECT p.player_name name,COUNT(DISTINCT p.map_id) maps,AVG(p.acs) acs,AVG(p.adr) adr,
       SUM(p.kills) kills,SUM(p.deaths) deaths,SUM(p.assists) assists
     FROM valorant_player_maps p JOIN valorant_maps m ON m.id=p.map_id JOIN valorant_series s ON s.id=m.series_id JOIN latest l
     WHERE p.team_id=? AND p.player_name IN (SELECT player_name FROM latest_lineup) AND s.played_at>=datetime(l.played_at,'-45 days')
     GROUP BY p.player_name ORDER BY maps DESC,adr DESC`,
  ).bind(teamId, teamId).all<{ name: string; maps: number; acs: number | null; adr: number | null; kills: number; deaths: number; assists: number }>();
  return results;
}

async function latestValorantSeries(db: D1Database) {
  const { results: series = [] } = await db.prepare(
    `SELECT s.id,s.played_at playedAt,s.event_name event,s.best_of bestOf,s.team_a_score teamAScore,s.team_b_score teamBScore,a.name teamA,b.name teamB,w.name winner
     FROM valorant_series s JOIN valorant_teams a ON a.id=s.team_a_id JOIN valorant_teams b ON b.id=s.team_b_id LEFT JOIN valorant_teams w ON w.id=s.winner_team_id ORDER BY s.played_at DESC LIMIT 18`,
  ).all<any>();
  if (!series.length) return [];
  const ids = series.map((row: any) => row.id);
  const { results: maps = [] } = await db.prepare(
    `SELECT m.id,m.series_id seriesId,m.map_number number,m.map_name name,m.team_a_score teamAScore,m.team_b_score teamBScore,a.name teamA,b.name teamB,w.name winner
     FROM valorant_maps m JOIN valorant_series s ON s.id=m.series_id JOIN valorant_teams a ON a.id=s.team_a_id JOIN valorant_teams b ON b.id=s.team_b_id LEFT JOIN valorant_teams w ON w.id=m.winner_team_id WHERE m.series_id IN (${ids.map(() => "?").join(",")}) ORDER BY m.series_id,m.map_number`,
  ).bind(...ids).all<any>();
  const mapIds = maps.map((row: any) => row.id);
  const { results: players = [] } = mapIds.length ? await db.prepare(
    `SELECT p.map_id mapId,p.player_name player,p.agent,p.acs,p.kills,p.deaths,p.assists,t.name team FROM valorant_player_maps p JOIN valorant_teams t ON t.id=p.team_id WHERE p.map_id IN (${mapIds.map(() => "?").join(",")}) ORDER BY p.map_id,p.team_id,p.acs DESC`,
  ).bind(...mapIds).all<any>() : { results: [] };
  const byMap = new Map<number, any[]>();
  for (const map of maps) byMap.set(map.id, []);
  for (const player of players) byMap.get(player.mapId)?.push(player);
  const mapsBySeries = new Map<number, any[]>();
  for (const map of maps) mapsBySeries.set(map.seriesId, [...(mapsBySeries.get(map.seriesId) ?? []), { ...map, players: byMap.get(map.id) ?? [] }]);
  return series.map((row: any) => ({ ...row, maps: mapsBySeries.get(row.id) ?? [] }));
}

async function valorantHeadToHeadSeries(db: D1Database, teamA: number, teamB: number) {
  const { results: series = [] } = await db.prepare(
    `SELECT s.id,s.played_at playedAt,s.event_name event,s.best_of bestOf,s.team_a_score teamAScore,s.team_b_score teamBScore,a.name teamA,b.name teamB,w.name winner
     FROM valorant_series s JOIN valorant_teams a ON a.id=s.team_a_id JOIN valorant_teams b ON b.id=s.team_b_id LEFT JOIN valorant_teams w ON w.id=s.winner_team_id
     WHERE (s.team_a_id=? AND s.team_b_id=?) OR (s.team_a_id=? AND s.team_b_id=?) ORDER BY s.played_at DESC LIMIT 30`,
  ).bind(teamA, teamB, teamB, teamA).all<any>();
  if (!series.length) return [];
  const ids = series.map((row: any) => row.id);
  const { results: maps = [] } = await db.prepare(
    `SELECT m.series_id seriesId,m.map_number number,m.map_name name,m.team_a_score teamAScore,m.team_b_score teamBScore,a.name teamA,b.name teamB,w.name winner
     FROM valorant_maps m JOIN valorant_series s ON s.id=m.series_id JOIN valorant_teams a ON a.id=s.team_a_id JOIN valorant_teams b ON b.id=s.team_b_id LEFT JOIN valorant_teams w ON w.id=m.winner_team_id
     WHERE m.series_id IN (${ids.map(() => "?").join(",")}) ORDER BY m.series_id,m.map_number`,
  ).bind(...ids).all<any>();
  const mapsBySeries = new Map<number, any[]>();
  for (const map of maps) mapsBySeries.set(map.seriesId, [...(mapsBySeries.get(map.seriesId) ?? []), map]);
  return series.map((row: any) => ({ ...row, maps: mapsBySeries.get(row.id) ?? [] }));
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/admin/oracle/")) return handleOracleAdmin(request, env, url.pathname);
    if (url.pathname === "/api/admin/valorant/series") return handleValorantAdmin(request, env);
    if (url.pathname === "/api/health") return json({ ok: true, source: "Oracle's Elixir", coverage: "2022+" });
    if (url.pathname === "/api/summoner") return summonerLookup(request, env, url);
    if (url.pathname === "/api/summoner/match") return fullMatchDetails(env, url);
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
    if (url.pathname === "/api/team-roster") {
      const teamId = Number(url.searchParams.get("team"));
      if (!Number.isInteger(teamId)) return json({ error: "Choose a team." }, 400);
      return json(await teamRoster(env.DB, teamId));
    }
    if (url.pathname === "/api/valorant/teams") {
      const { results = [] } = await env.DB.prepare(
        `SELECT t.id,t.name,COUNT(m.id) maps FROM valorant_teams t JOIN valorant_series s ON s.team_a_id=t.id OR s.team_b_id=t.id JOIN valorant_maps m ON m.series_id=s.id WHERE s.played_at>='2025-01-01' AND s.played_at<'2027-01-01' GROUP BY t.id,t.name HAVING maps>=3 ORDER BY t.name`,
      ).all();
      return json(results);
    }
    if (url.pathname === "/api/valorant/maps") {
      const { results = [] } = await env.DB.prepare("SELECT map_name name,COUNT(*) maps FROM valorant_maps GROUP BY map_name HAVING maps>=5 ORDER BY name").all();
      return json(results);
    }
    if (url.pathname === "/api/valorant/latest-series") return json(await latestValorantSeries(env.DB));
    if (url.pathname === "/api/valorant/match-history") {
      const teamA = Number(url.searchParams.get("teamA")), teamB = Number(url.searchParams.get("teamB"));
      if (!Number.isInteger(teamA) || !Number.isInteger(teamB) || teamA === teamB) return json({ error: "Select two distinct Valorant teams." }, 400);
      return json(await valorantHeadToHeadSeries(env.DB, teamA, teamB));
    }
    if (url.pathname === "/api/valorant/map-pool") {
      const leftId = Number(url.searchParams.get("teamA")), rightId = Number(url.searchParams.get("teamB"));
      if (!Number.isInteger(leftId) || !Number.isInteger(rightId) || leftId === rightId) return json({ error: "Select two distinct Valorant teams." }, 400);
      return json(await valorantMapPool(env.DB, leftId, rightId));
    }
    if (url.pathname === "/api/valorant/matchup") {
      const leftId = Number(url.searchParams.get("teamA")), rightId = Number(url.searchParams.get("teamB"));
      if (!Number.isInteger(leftId) || !Number.isInteger(rightId) || leftId === rightId) return json({ error: "Select two distinct Valorant teams." }, 400);
      const mapValue = url.searchParams.get("map")?.trim() ?? "";
      const mapName = mapValue && mapValue.length <= 40 ? mapValue : null;
      const roundsValue = Number(url.searchParams.get("roundsLine"));
      const roundsLine = Number.isFinite(roundsValue) && roundsValue >= 10 && roundsValue <= 60 ? roundsValue : null;
      const requestedBestOf = Number(url.searchParams.get("bestOf"));
      const bestOf = [1, 3, 5].includes(requestedBestOf) ? requestedBestOf : 3;
      const draftA = parseValorantDraft(url.searchParams.get("draftA")), draftB = parseValorantDraft(url.searchParams.get("draftB"));
      const [left, right, headToHead, meta, draftAStats, draftBStats, playerFormA, playerFormB] = await Promise.all([
        valorantProfile(env.DB, leftId, mapName), valorantProfile(env.DB, rightId, mapName), valorantHeadToHead(env.DB, leftId, rightId), valorantRollingMeta(env.DB, leftId, rightId),
        valorantDraftFit(env.DB, leftId, draftA), valorantDraftFit(env.DB, rightId, draftB), valorantPlayerForm(env.DB, leftId), valorantPlayerForm(env.DB, rightId),
      ]);
      if (!left || !right || left.maps < 3 || right.maps < 3) return json({ error: "Both teams need at least three imported Valorant maps from 2025–2026." }, 404);
      const prediction = predictValorant(left, right, roundsLine, bestOf, meta.coverage);
      return json({ teamA: left.name, teamB: right.name, selectedMap: mapName, ...prediction, model: "Valorant time-aware map model", teamAContext: left, teamBContext: right, headToHead, meta, draft: { teamA: draftAStats, teamB: draftBStats }, playerForm: { teamA: playerFormA, teamB: playerFormB } });
    }
    if (url.pathname === "/api/latest-series") return json(await latestSeries(env.DB));
    if (url.pathname === "/api/match-history") {
      const teamId = Number(url.searchParams.get("team"));
      const opponentValue = url.searchParams.get("opponent");
      const opponentId = opponentValue === null ? undefined : Number(opponentValue);
      if (!Number.isInteger(teamId) || (opponentValue !== null && (!Number.isInteger(opponentId) || teamId === opponentId))) {
        return json({ error: "Select one team, or two distinct teams." }, 400);
      }
      return json(await latestSeries(env.DB, { teamId, opponentId }));
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
      const requestedBestOf = Number(url.searchParams.get("bestOf"));
      const bestOf = [1, 3, 5].includes(requestedBestOf) ? requestedBestOf : 1;
      const expectedLineupA = parseLineup(url.searchParams.get("lineupA"));
      const expectedLineupB = parseLineup(url.searchParams.get("lineupB"));
      const latest = await currentPatch(env.DB);
      const patch = latest?.patch ?? null;
      const referenceDate = latest?.playedAt ? new Date(`${latest.playedAt.replace(" ", "T")}Z`) : new Date();
      const [left, right, elo] = await Promise.all([teamProfile(env.DB, leftId, patch, referenceDate, expectedLineupA), teamProfile(env.DB, rightId, patch, referenceDate, expectedLineupB), lolEloSignal(env.DB, leftId, rightId)]);
      if (!left || !right) return json({ error: "Both teams need imported Oracle's Elixir statistics." }, 404);
      const prediction = predictTimeAware(left, right, killsLine, durationLine, elo, bestOf);
      const lineupA = lineupConfirmation(left, expectedLineupA), lineupB = lineupConfirmation(right, expectedLineupB);
      const lineupConfidence = [lineupA, lineupB].some((lineup) => lineup.expected.length) ? (lineupA.confirmed && lineupB.confirmed ? 1 : 0.85) : 1;
      return json({
        teamA: left.name,
        teamB: right.name,
        ...prediction,
        confidence: prediction.confidence * lineupConfidence,
        lineup: { teamA: lineupA, teamB: lineupB },
        model: "Time-aware roster and patch model",
        currentPatch: patch,
        elo: { teamA: Math.round(elo.leftRating), teamB: Math.round(elo.rightRating), probabilityA: elo.probabilityA },
        asOf: latest?.playedAt ?? [left.lastGameAt, right.lastGameAt].filter((date): date is string => !!date).sort().at(-1) ?? null,
        teamAContext: { games: left.games, effectiveGames: left.effectiveGames, recentGames: left.recentGames, recentWins: left.recentWins, roster: left.roster, patchPlayerGames: left.patchPlayerGames, patchChampionCount: left.patchChampionCount, patchReadiness: left.patchReadiness },
        teamBContext: { games: right.games, effectiveGames: right.effectiveGames, recentGames: right.recentGames, recentWins: right.recentWins, roster: right.roster, patchPlayerGames: right.patchPlayerGames, patchChampionCount: right.patchChampionCount, patchReadiness: right.patchReadiness },
      });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
