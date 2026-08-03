import { createHash } from "node:crypto";

const workerUrl = process.env.ORACLE_IMPORT_URL?.replace(/\/$/, "");
const token = process.env.ORACLE_IMPORT_TOKEN;
const maxGames = Number(process.env.GOL_MAX_GAMES ?? 80);
const dryRun = process.env.GOL_DRY_RUN === "1";
const userAgent = "lol-stats-predictor/1.0 (+https://github.com/Rerkaaa/lol-stats-predictor)";

if (!workerUrl || !token || !Number.isInteger(maxGames) || maxGames < 1 || maxGames > 500) {
  throw new Error("Set ORACLE_IMPORT_URL, ORACLE_IMPORT_TOKEN, and GOL_MAX_GAMES (1-500).");
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const decode = (value) => value.replaceAll("&amp;", "&").replaceAll("&#039;", "'").trim();
const number = (value) => Number(String(value ?? "").replace(/,/g, "")) || 0;

async function get(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "user-agent": userAgent, ...(options.headers ?? {}) } });
  if (!response.ok) throw new Error(`Games of Legends returned HTTP ${response.status} for ${url}`);
  return response.text();
}

async function post(path, body) {
  let lastError = "unknown error";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(`${workerUrl}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (response.ok) return text ? JSON.parse(text) : {};
      lastError = `${response.status} ${text}`;
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(600 * 2 ** attempt);
  }
  throw new Error(`Worker request ${path} failed: ${lastError}`);
}

async function latestImportedDate() {
  const response = await fetch(`${workerUrl}/api/latest-series`, { headers: { "user-agent": userAgent } });
  if (!response.ok) throw new Error(`Could not read the current import date (HTTP ${response.status}).`);
  const series = await response.json();
  const latest = Array.isArray(series) ? series.map((item) => String(item.playedAt ?? "").slice(0, 10)).sort().at(-1) : null;
  if (!latest || !/^20\d{2}-\d{2}-\d{2}$/.test(latest)) throw new Error("Could not determine the current import date.");
  return latest;
}

function latestGames(html) {
  const parsed = JSON.parse(html.trim());
  return parsed.map((game) => ({ id: String(game.game_id), date: String(game.game_date), tournament: String(game.tournament ?? "Games of Legends") }));
}

function textAfter(block, label) {
  const match = block.match(new RegExp(`${label}[\\s\\S]{0,500}?<span[^>]*>\\s*(?:<img[^>]*>\\s*)?([^<]+)<\\/span>`, "i"));
  return match ? match[1].trim() : "";
}

function teamBlock(html, side) {
  const marker = side === "blue" ? "blue-line-header" : "red-line-header";
  const other = side === "blue" ? "red-line-header" : "playersInfosLine";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const end = html.indexOf(other, start + marker.length);
  return html.slice(start, end < 0 ? start + 18000 : end);
}

function teamFromBlock(block, side) {
  if (!block) return null;
  const heading = block.match(/title=['"]([^'"]+) stats['"][^>]*>([^<]+)<\/a>\s*-\s*(WIN|LOSS)/i);
  if (!heading) return null;
  const metric = (icon, fallback = 0) => {
    const match = block.match(new RegExp(`alt='${icon}'[\\s\\S]{0,120}?\\/>\\s*([0-9.]+k?)`, "i"));
    if (!match) return fallback;
    const raw = match[1];
    return raw.endsWith("k") ? Math.round(Number(raw.slice(0, -1)) * 1000) : number(raw);
  };
  return {
    name: decode(heading[2]), result: heading[3].toUpperCase() === "WIN" ? 1 : 0,
    kills: metric("Kills"), towers: metric("Towers"), dragons: metric("Dragons"), barons: metric("Nashor"), gold: metric("Team Gold"),
    firstBlood: /firstblood3\.png/i.test(block) ? 1 : 0,
    firstTower: /firsttower2\.png/i.test(block) ? 1 : 0,
    bans: [...block.matchAll(/<div class="col-2">Bans<\/div>[\s\S]*?<div class="col-10">([\s\S]*?)<\/div>/gi)].flatMap((match) => [...match[1].matchAll(/alt='([^']+)'/g)].map((item) => decode(item[1]))).slice(0, 5),
    picks: [...block.matchAll(/<div class="col-2">Picks[\s\S]*?<\/div>\s*<div class="col-10">([\s\S]*?)<\/div>/gi)].flatMap((match) => [...match[1].matchAll(/alt='([^']+)'/g)].map((item) => decode(item[1]))).slice(0, 5),
    side,
  };
}

function playersFromHtml(html, team, roles) {
  const tableStart = html.indexOf(`playersInfosLine footable toggle-square-filled`);
  if (tableStart < 0) return [];
  const nextTable = html.indexOf("playersInfosLine footable toggle-square-filled", tableStart + 1);
  const table = html.slice(tableStart, nextTable < 0 ? tableStart + 50000 : nextTable);
  const rows = [...table.matchAll(/title='([^']+) stats'><img[^>]+alt='([^']+)'[\s\S]*?title='([^']+) stats'>([^<]+)<\/a>[\s\S]*?<td style='text-align:center'>(\d+)\/(\d+)\/(\d+)<\/td><td[^>]*>\s*(\d+)/g)];
  return rows.slice(0, 5).map((row, index) => ({
    teamname: team, playername: decode(row[4]), champion: decode(row[2]), position: roles[index],
    kills: row[5], deaths: row[6], assists: row[7], "total cs": row[8], participantid: String(index + 1),
  }));
}

function toRows(gameId, html, metadata) {
  const durationMatch = html.match(/Game Time\s*<br\s*\/?>\s*<h1>\s*(\d+):(\d+)\s*<\/h1>/i);
  const patchMatch = html.match(/v(\d+\.\d+)/i);
  const blue = teamFromBlock(teamBlock(html, "blue"), "blue");
  const red = teamFromBlock(teamBlock(html, "red"), "red");
  if (!durationMatch || !blue || !red) return null;
  const date = metadata.date;
  const seconds = Number(durationMatch[1]) * 60 + Number(durationMatch[2]);
  const league = metadata.tournament;
  const base = (team, participantid) => ({ gameid: `gol:${gameId}`, participantid, datacompleteness: "complete", league, date: `${date} 12:00:00`, patch: patchMatch?.[1] ?? "", side: team.side, teamname: team.name, result: String(team.result), gamelength: String(seconds), kills: String(team.kills), deaths: "", assists: "", totalgold: String(team.gold), firstblood: String(team.firstBlood), firsttower: String(team.firstTower), dragons: String(team.dragons), barons: String(team.barons), heralds: "", towers: String(team.towers), ban1: team.bans[0] ?? "", ban2: team.bans[1] ?? "", ban3: team.bans[2] ?? "", ban4: team.bans[3] ?? "", ban5: team.bans[4] ?? "", pick1: team.picks[0] ?? "", pick2: team.picks[1] ?? "", pick3: team.picks[2] ?? "", pick4: team.picks[3] ?? "", pick5: team.picks[4] ?? "" });
  const roles = ["top", "jungle", "mid", "bot", "support"];
  const blueRows = playersFromHtml(html, blue.name, roles).map((player) => ({ ...base(blue, player.participantid), ...player }));
  const redRows = playersFromHtml(html.slice(html.indexOf("playersInfosLine footable toggle-square-filled", html.indexOf("playersInfosLine footable toggle-square-filled") + 1)), red.name, roles).map((player) => ({ ...base(red, Number(player.participantid) + 5), ...player }));
  return [base(blue, "100"), base(red, "200"), ...blueRows, ...redRows];
}

function linkedGameIds(html, gameId) {
  const ids = new Set([String(gameId)]);
  for (const match of html.matchAll(/game\/stats\/(\d+)\/page-game/gi)) ids.add(match[1]);
  return [...ids];
}

const latestImported = dryRun ? null : await latestImportedDate();
const candidates = [];
for (let start = 0; candidates.length < maxGames && start < 1000; start += 10) {
  const body = await get("https://gol.gg/esports/ajax.home.php", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `start=${start}` });
  const ids = latestGames(body);
  if (!ids.length) break;
  for (const game of ids) if ((!latestImported || game.date >= latestImported) && !candidates.some((item) => item.id === game.id) && candidates.length < maxGames) candidates.push(game);
  if (latestImported && ids.every((game) => game.date < latestImported)) break;
  await delay(250);
}

const knownIds = new Set();
if (!dryRun) {
  for (let index = 0; index < candidates.length; index += 80) {
    const known = await post("/api/admin/oracle/known-games", { games: candidates.slice(index, index + 80).map((game) => `gol:${game.id}`) });
    for (const gameId of known.knownGameIds ?? []) knownIds.add(gameId);
  }
}

const games = [];
const parsedPageIds = new Set();
// Always inspect the listed first game: an already-known Game 1 can link to
// newly completed Game 2/Game 3 pages that the home feed does not list itself.
for (const candidate of candidates) {
  const url = `https://gol.gg/game/stats/${candidate.id}/page-game/`;
  const html = await get(url);
  for (const gameId of linkedGameIds(html, candidate.id)) {
    if (parsedPageIds.has(gameId)) continue;
    parsedPageIds.add(gameId);
    const pageHtml = gameId === candidate.id ? html : await get(`https://gol.gg/game/stats/${gameId}/page-game/`);
    const rows = toRows(gameId, pageHtml, candidate);
    if (rows?.length >= 2) games.push({ gameId: `gol:${gameId}`, sourceHash: sha256(pageHtml), rows, url: `https://gol.gg/game/stats/${gameId}/page-game/` });
    if (gameId !== candidate.id) await delay(350);
  }
  await delay(350);
}

console.log(JSON.stringify({ after: latestImported, discovered: candidates.length, parsed: games.length, sample: games.slice(0, 2).map((game) => ({ gameId: game.gameId, rows: game.rows.length, teams: game.rows.filter((row) => row.participantid === "100" || row.participantid === "200").map((row) => row.teamname) })) }, null, 2));
if (dryRun) process.exit(0);

const sourceHash = sha256(JSON.stringify(games.map(({ gameId, sourceHash: gameHash }) => [gameId, gameHash])));
const sourceUrl = "https://gol.gg/esports/home/";
await post("/api/admin/oracle/start", { year: new Date().getUTCFullYear(), sourceUrl, sourceHash });
const changedIds = new Set();
for (let index = 0; index < games.length; index += 80) {
  const batch = games.slice(index, index + 80).map(({ gameId, sourceHash: gameHash }) => ({ gameId, sourceHash: gameHash }));
  const changed = await post("/api/admin/oracle/changed-games", { year: new Date().getUTCFullYear(), sourceUrl, sourceHash, games: batch });
  for (const gameId of changed.changedGameIds ?? []) changedIds.add(gameId);
}
let accepted = 0, skipped = games.length - changedIds.size, rejected = 0;
for (const game of games.filter((item) => changedIds.has(item.gameId))) {
  const result = await post("/api/admin/oracle/games", { year: new Date().getUTCFullYear(), sourceUrl: game.url, sourceHash, games: [game] });
  accepted += result.accepted ?? 0; skipped += result.skipped ?? 0; rejected += result.rejected ?? 0;
  await delay(150);
}
await post("/api/admin/oracle/complete", { year: new Date().getUTCFullYear(), sourceUrl, sourceHash });
console.log(JSON.stringify({ discovered: candidates.length, parsed: games.length, accepted, skipped, rejected }));
