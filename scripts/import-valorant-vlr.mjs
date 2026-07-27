const workerUrl = process.env.VALORANT_IMPORT_URL?.replace(/\/$/, "");
const token = process.env.VALORANT_IMPORT_TOKEN;
const dryRun = process.env.VALORANT_DRY_RUN === "1";
const eventLimit = Math.max(1, Math.min(60, Number(process.env.VLR_EVENT_LIMIT || 60)));
const matchLimit = Math.max(1, Math.min(800, Number(process.env.VLR_MATCH_LIMIT || 800)));
const years = process.argv.slice(2).map(Number).filter((year) => year === 2025 || year === 2026);
const targetYears = years.length ? years : [2025, 2026];

if (!dryRun && (!workerUrl || !token)) throw new Error("VALORANT_IMPORT_URL and VALORANT_IMPORT_TOKEN are required.");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value) => value.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#039;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const number = (value) => { const parsed = Number(String(value).replace(/[^\d.-]/g, "")); return Number.isFinite(parsed) ? parsed : null; };
const duration = (value) => { const match = String(value).match(/(\d+):(\d+)/); return match ? Number(match[1]) * 60 + Number(match[2]) : null; };

async function get(path) {
  await sleep(700);
  const response = await fetch(`https://www.vlr.gg${path}`, { headers: { "user-agent": "LoL-Stats-Predictor/1.0 (historical research; contact via GitHub)", accept: "text/html" } });
  if (!response.ok) throw new Error(`VLR returned HTTP ${response.status} for ${path}`);
  return response.text();
}

async function post(series) {
  if (dryRun) { console.log(`Dry run: parsed ${series.length} series.`, series.map((item) => `${item.teamA} vs ${item.teamB} (${item.maps.length} maps; ${item.maps.map((map) => map.players?.length ?? 0).join("/")} player rows)`).join("; ")); return { dryRun: true }; }
  const response = await fetch(`${workerUrl}/api/admin/valorant/series`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ series }),
  });
  if (!response.ok) throw new Error(`Worker import returned HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

function eventLinks(html) {
  const links = new Map();
  for (const match of html.matchAll(/href="(\/event\/(\d+)\/([^"?#]+))[^" ]*"/g)) {
    const [, path, id, slug] = match;
    if (targetYears.some((year) => slug.includes(String(year)))) links.set(id, { id, slug, path });
  }
  return [...links.values()].slice(0, eventLimit);
}

function eventMatches(html, event) {
  const output = [];
  let date = null;
  const tokenPattern = /<div class="wf-label mod-large">([\s\S]*?)<\/div>|<a href="(\/\d+\/[^"?#]+)" class="wf-module-item match-item[^"]*">([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(tokenPattern)) {
    if (match[1] !== undefined) { date = text(match[1]); continue; }
    if (!date || !match[2]) continue;
    const body = match[3];
    const names = [...body.matchAll(/match-item-vs-team-name[\s\S]{0,900}?<div class="text-of">([\s\S]*?)<\/div>/g)].map((part) => text(part[1]));
    const scores = [...body.matchAll(/match-item-vs-team-score[^>]*>([\s\S]*?)<\/div>/g)].map((part) => number(part[1]));
    const timestamp = Date.parse(date);
    if (names.length < 2 || Number.isNaN(timestamp)) continue;
    const playedAt = new Date(timestamp).toISOString();
    if (!targetYears.includes(new Date(playedAt).getUTCFullYear())) continue;
    output.push({ path: match[2], id: match[2].split("/")[1], date: playedAt, teamA: names[0], teamB: names[1], teamAScore: scores[0], teamBScore: scores[1], event });
  }
  return output;
}

function divBlock(html, start) {
  let cursor = start, depth = 0;
  const tag = /<\/?div\b[^>]*>/g;
  tag.lastIndex = start;
  for (let match; (match = tag.exec(html));) {
    if (match[0].startsWith("</")) depth--; else depth++;
    if (depth === 0) return html.slice(start, tag.lastIndex);
    cursor = tag.lastIndex;
  }
  return html.slice(start, cursor);
}

function mapBlocks(html) {
  const starts = [...html.matchAll(/<div class="vm-stats-game(?:\s|")/g)].map((match) => match.index).filter((index) => index !== undefined);
  return starts.map((start) => divBlock(html, start));
}

function columnValue(row, column) {
  const match = row.match(new RegExp(`data-col="${column}"[\\s\\S]{0,500}?<span class="side mod-both[^>]*">\\s*([^<]+)`, "i"));
  return match ? number(match[1]) : null;
}

function kdaValue(row, column) {
  const match = row.match(new RegExp(`ovw-kda-stat" data-col="${column}">[\\s\\S]{0,350}?<span class="side mod-both[^>]*">\\s*([^<]+)`, "i"));
  return match ? number(match[1]) : null;
}

function mapPlayers(block) {
  const starts = [...block.matchAll(/<div class="ovw-row">/g)].map((match) => match.index).filter((index) => index !== undefined);
  return starts.map((start, index) => {
    const row = divBlock(block, start);
    const name = text(row.match(/ovw-player-name text-of">([\s\S]*?)<\/div>/)?.[1] ?? "");
    if (!name) return null;
    return {
      team: index < 5 ? "A" : "B", name,
      agent: text(row.match(/class="ovw-agents"[\s\S]{0,500}?alt="([^"]+)"/)?.[1] ?? "") || undefined,
      rating: columnValue(row, "rating2"), acs: columnValue(row, "acs"), adr: columnValue(row, "adr"), headshotPercent: columnValue(row, "hsp"),
      kills: kdaValue(row, "kills"), deaths: kdaValue(row, "deaths"), assists: kdaValue(row, "assists"), firstKills: columnValue(row, "fb"), firstDeaths: columnValue(row, "fd"),
    };
  }).filter(Boolean);
}

function parseMatch(meta, html) {
  const maps = [];
  let mapNumber = 0;
  for (const block of mapBlocks(html)) {
    const names = [...block.matchAll(/class="team-name">\s*([\s\S]*?)\s*<\/div>/g)].map((part) => text(part[1]));
    const scores = [...block.matchAll(/class="score[^>]*">\s*([\d]+)\s*<\/div>/g)].map((part) => number(part[1]));
    const mapName = text(block.match(/class="map">[\s\S]{0,1200}?<span[^>]*>\s*([^<]+?)\s*<span/)?.[1] ?? "");
    if (names.length < 2 || scores.length < 2 || !mapName || mapName === "All Maps") continue;
    mapNumber++;
    const teamAIsFirst = names[0] === meta.teamA;
    maps.push({ number: mapNumber, name: mapName, durationSeconds: duration(text(block.match(/class="map-duration[^>]*">([\s\S]*?)<\/div>/)?.[1] ?? "")), teamAScore: teamAIsFirst ? scores[0] : scores[1], teamBScore: teamAIsFirst ? scores[1] : scores[0], winner: scores[0] === scores[1] ? undefined : scores[0] > scores[1] ? (teamAIsFirst ? "A" : "B") : (teamAIsFirst ? "B" : "A"), players: mapPlayers(block).map((player) => ({ ...player, team: teamAIsFirst ? player.team : player.team === "A" ? "B" : "A" })) });
  }
  if (!maps.length) { if (dryRun) console.warn(`No played map rows parsed for ${meta.id}.`); return null; }
  const winner = meta.teamAScore === meta.teamBScore ? undefined : meta.teamAScore > meta.teamBScore ? "A" : "B";
  return { id: `vlr:${meta.id}`, url: `https://www.vlr.gg${meta.path}`, event: meta.event.slug.replace(/-/g, " "), tier: "VCT", playedAt: meta.date, bestOf: Math.max(1, maps.length), teamA: meta.teamA, teamB: meta.teamB, teamAScore: meta.teamAScore, teamBScore: meta.teamBScore, winner, maps };
}

const overview = await get("/vct/");
const events = eventLinks(overview);
console.log(`Found ${events.length} VCT events for ${targetYears.join(", ")}.`);
const matchMeta = [];
for (const event of events) {
  const html = await get(`/event/matches/${event.id}/${event.slug}/?group=completed&series_id=all`);
  matchMeta.push(...eventMatches(html, event));
}
const uniqueMatches = [...new Map(matchMeta.map((match) => [match.id, match])).values()].slice(0, matchLimit);
console.log(`Collecting ${uniqueMatches.length} completed VCT series.`);
const imported = [];
for (const meta of uniqueMatches) {
  try {
    const series = parseMatch(meta, await get(meta.path));
    if (series) imported.push(series);
  } catch (error) {
    console.warn(`Skipping VLR match ${meta.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (imported.length === 25) { console.log(await post(imported.splice(0, imported.length))); }
}
if (imported.length) console.log(await post(imported));
console.log("Valorant VCT import complete.");
