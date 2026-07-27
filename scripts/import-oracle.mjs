import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";

const [yearText, sourceUrl] = process.argv.slice(2);
const year = Number(yearText);
const workerUrl = process.env.ORACLE_IMPORT_URL?.replace(/\/$/, "");
const token = process.env.ORACLE_IMPORT_TOKEN;
const maxGames = Number(process.env.ORACLE_MAX_GAMES ?? 0);
const mirrorBaseUrl = process.env.ORACLE_MIRROR_BASE_URL?.replace(/\/$/, "") ?? "https://pub-b6eea12acc9142678d1e15941794c319.r2.dev";

if (!Number.isInteger(year) || year < 2020 || !sourceUrl || !workerUrl || !token || !Number.isInteger(maxGames) || maxGames < 0) {
  throw new Error("Usage: node scripts/import-oracle.mjs YEAR CSV_URL with ORACLE_IMPORT_URL and ORACLE_IMPORT_TOKEN set.");
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function downloadCsv(url) {
  const response = await fetch(url);
  const sourceBytes = Buffer.from(await response.arrayBuffer());
  const preview = sourceBytes.subarray(0, 512).toString("utf8").trimStart();
  if (!response.ok) throw new Error(`download returned HTTP ${response.status}`);
  if (/<!doctype html|<html\b/i.test(preview)) {
    if (/quota exceeded|too many users|download quota/i.test(preview)) throw new Error("Google Drive download quota is exhausted");
    throw new Error("received an HTML page instead of a CSV file");
  }
  if (!/^\ufeff?gameid,/i.test(preview)) throw new Error("received data without the expected Oracle CSV header");
  return sourceBytes;
}

async function post(path, body) {
  let lastError = "Unknown import error";
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
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(500 * 2 ** attempt);
  }
  throw new Error(`Worker request ${path} failed: ${lastError}`);
}

const mirrorUrl = `${mirrorBaseUrl}/${year}_LoL_esports_match_data_from_OraclesElixir.csv`;
let effectiveSourceUrl = sourceUrl;
let sourceBytes;
try {
  sourceBytes = await downloadCsv(sourceUrl);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`Oracle download failed (${reason}). Trying the R2 mirror.`);
  try {
    sourceBytes = await downloadCsv(mirrorUrl);
    effectiveSourceUrl = mirrorUrl;
    console.log(`Using R2 mirror for season ${year}.`);
  } catch (mirrorError) {
    const mirrorReason = mirrorError instanceof Error ? mirrorError.message : String(mirrorError);
    throw new Error(`Oracle download failed (${reason}) and the R2 mirror is unavailable (${mirrorReason}). Upload ${year}_LoL_esports_match_data_from_OraclesElixir.csv to ${mirrorBaseUrl} first.`);
  }
}
const sourceHash = sha256(sourceBytes);
const start = await post("/api/admin/oracle/start", { year, sourceUrl: effectiveSourceUrl, sourceHash });
if (start.unchanged) {
  console.log(JSON.stringify({ year, skipped: true, reason: "The source file is unchanged." }));
  process.exit(0);
}

const rows = parse(sourceBytes.toString("utf8"), {
  columns: true,
  skip_empty_lines: true,
  relax_column_count: true,
  bom: true,
});
const byGame = new Map();
for (const row of rows) {
  const gameId = String(row.gameid ?? "").trim();
  if (!gameId) continue;
  const gameRows = byGame.get(gameId) ?? [];
  gameRows.push(row);
  byGame.set(gameId, gameRows);
}

const games = [...byGame.entries()].map(([gameId, gameRows]) => ({ gameId, sourceHash: sha256(JSON.stringify(gameRows)), rows: gameRows }));
const changedIds = new Set();
for (let index = 0; index < games.length; index += 80) {
  const hashBatch = games.slice(index, index + 80).map(({ gameId, sourceHash: gameHash }) => ({ gameId, sourceHash: gameHash }));
  const response = await post("/api/admin/oracle/changed-games", { year, sourceUrl: effectiveSourceUrl, sourceHash, games: hashBatch });
  for (const gameId of response.changedGameIds ?? []) changedIds.add(gameId);
}

const changedGames = games.filter((game) => changedIds.has(game.gameId));
const gamesToImport = maxGames > 0 ? changedGames.slice(0, maxGames) : changedGames;
let accepted = 0;
let skipped = games.length - changedGames.length;
let rejected = 0;
for (let index = 0; index < gamesToImport.length; index += 2) {
  const batch = gamesToImport.slice(index, index + 2);
  const response = await post("/api/admin/oracle/games", { year, sourceUrl: effectiveSourceUrl, sourceHash, games: batch });
  accepted += response.accepted ?? 0;
  skipped += response.skipped ?? 0;
  rejected += response.rejected ?? 0;
  const completed = Math.min(index + batch.length, gamesToImport.length);
  if (completed === gamesToImport.length || completed % 25 === 0) console.log(`${completed}/${gamesToImport.length} changed games processed`);
  await delay(40);
}

if (gamesToImport.length !== changedGames.length) {
  console.log(JSON.stringify({ year, sourceRows: rows.length, games: games.length, changedGames: changedGames.length, processedGames: gamesToImport.length, accepted, skipped, rejected, complete: false }));
  process.exit(0);
}

await post("/api/admin/oracle/complete", { year, sourceUrl: effectiveSourceUrl, sourceHash });
console.log(JSON.stringify({ year, sourceRows: rows.length, games: games.length, changedGames: changedGames.length, accepted, skipped, rejected }));
