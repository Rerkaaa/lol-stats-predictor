import { parse } from "csv-parse/sync";

const [year, sourceUrl] = process.argv.slice(2);
const workerUrl = process.env.ORACLE_IMPORT_URL;
const token = process.env.ORACLE_IMPORT_TOKEN;
if (!/^\d{4}$/.test(year ?? "") || !sourceUrl || !workerUrl || !token) throw new Error("Usage: node scripts/import-oracle.mjs YEAR CSV_URL with ORACLE_IMPORT_URL and ORACLE_IMPORT_TOKEN set.");
const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`Oracle CSV download failed: ${response.status}`);
const csv = await response.text();
const rows = parse(csv, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });
let accepted = 0, rejected = 0;
for (let start = 0; start < rows.length; start += 250) {
  const batch = rows.slice(start, start + 250);
  const result = await fetch(`${workerUrl.replace(/\/$/, "")}/api/admin/oracle/rows`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ year: Number(year), sourceUrl, rows: batch }) });
  if (!result.ok) throw new Error(`Worker rejected batch ${start}: ${result.status} ${await result.text()}`);
  const payload = await result.json(); accepted += payload.accepted ?? 0; rejected += payload.rejected ?? 0;
  console.log(`${Math.min(start + batch.length, rows.length)}/${rows.length} rows sent`);
}
console.log(JSON.stringify({ year, rows: rows.length, accepted, rejected }));
