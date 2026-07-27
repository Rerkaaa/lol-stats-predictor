import { writeFile } from "node:fs/promises";

const [yearText, sourceUrl, outputPath] = process.argv.slice(2);
const year = Number(yearText);

if (!Number.isInteger(year) || year < 2020 || !sourceUrl || !outputPath) {
  throw new Error("Usage: node scripts/download-oracle-csv.mjs <year> <source-url> <output-path>");
}

const response = await fetch(sourceUrl);
const bytes = Buffer.from(await response.arrayBuffer());
const preview = bytes.subarray(0, 512).toString("utf8").trimStart();

if (!response.ok) {
  throw new Error(`Oracle download returned HTTP ${response.status}`);
}

if (/<!doctype html|<html\b/i.test(preview)) {
  if (/quota exceeded|too many users|download quota/i.test(preview)) {
    throw new Error("Google Drive download quota is exhausted");
  }
  throw new Error("Oracle source returned an HTML page instead of a CSV file");
}

if (!/^\ufeff?gameid,/i.test(preview)) {
  throw new Error("Oracle source did not return the expected CSV header");
}

await writeFile(outputPath, bytes);
console.log(`Downloaded verified Oracle CSV for ${year} (${bytes.length.toLocaleString()} bytes).`);
