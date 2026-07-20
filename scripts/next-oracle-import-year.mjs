const workerUrl = process.env.ORACLE_IMPORT_URL?.replace(/\/$/, "");
if (!workerUrl) throw new Error("ORACLE_IMPORT_URL is required to select the next backfill year.");

const response = await fetch(`${workerUrl}/api/import/status`);
if (!response.ok) throw new Error(`Import status request failed: ${response.status}`);
const payload = await response.json();
const imports = new Map((payload.imports ?? []).map((item) => [Number(item.source_year), item.status]));
const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Tirane", year: "numeric" }).formatToParts(new Date());
const currentYear = Number(parts.find((part) => part.type === "year")?.value);
const firstHistoricalYear = 2022;

const nextYear = Array.from({ length: currentYear - firstHistoricalYear + 1 }, (_, index) => currentYear - index)
  .find((year) => imports.get(year) !== "complete") ?? currentYear;
process.stdout.write(String(nextYear));
