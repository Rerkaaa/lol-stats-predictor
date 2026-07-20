const DEFAULT_FOLDER = "https://drive.google.com/drive/folders/1gLSw0RLjBbtaNy0dgnGQDAZOHIgCe-HH";

const [yearText, folderUrl = DEFAULT_FOLDER] = process.argv.slice(2);
if (!/^20\d{2}$/.test(yearText ?? "")) throw new Error("Usage: node scripts/resolve-oracle-drive-file.mjs YEAR [FOLDER_URL]");

const folderId = folderUrl.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1];
if (!folderId) throw new Error("The Oracle Drive folder URL does not contain a folder ID.");

const response = await fetch(`https://drive.google.com/drive/folders/${folderId}`);
if (!response.ok) throw new Error(`Google Drive folder request failed: ${response.status}`);
const html = await response.text();
const records = [...html.matchAll(/<tr\b[^>]*\bdata-id="([A-Za-z0-9_-]+)"[^>]*>[\s\S]*?<strong[^>]*>\s*(20\d{2}_LoL_esports_match_data_from_OraclesElixir\.csv)\s*<\/strong>/g)];
const expectedName = `${yearText}_LoL_esports_match_data_from_OraclesElixir.csv`;
const found = records.find((record) => record[2] === expectedName);
if (!found) throw new Error(`${expectedName} was not found in the public Oracle Drive folder.`);

process.stdout.write(`https://drive.google.com/uc?export=download&id=${found[1]}`);
