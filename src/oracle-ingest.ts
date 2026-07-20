import { normalizeOracleRow, type OracleRow } from "./oracle";

const hash = (value: string) => { let h = 2166136261; for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619); return (h >>> 0) & 0x7fffffff; };
const sourceTeamKey = (name: string) => `oracle:${name.trim().toLowerCase()}`;

async function teamId(db: D1Database, name: string) {
  const key = sourceTeamKey(name);
  await db.prepare("INSERT OR IGNORE INTO teams(name,source_key,source_url) VALUES(?,?,?)").bind(name, key, `oracle://team/${encodeURIComponent(name)}`).run();
  return (await db.prepare("SELECT id FROM teams WHERE source_key=?").bind(key).first<{ id: number }>())?.id ?? null;
}

export async function ingestOracleRows(db: D1Database, rawRows: OracleRow[]) {
  let accepted = 0, rejected = 0;
  for (const raw of rawRows) {
    const row = normalizeOracleRow(raw); if (!row) { rejected++; continue; }
    const team = await teamId(db, row.team); if (!team) { rejected++; continue; }
    const gameHash = hash(`oracle:${row.gameId}`);
    await db.prepare("INSERT OR IGNORE INTO matches(gol_game_id,source_game_id,played_at,patch,source_url) VALUES(?,?,?,?,?)").bind(gameHash, `oracle:${row.gameId}`, row.date, row.patch, `oracle://game/${row.gameId}`).run();
    const match = await db.prepare("SELECT id,blue_team_id,red_team_id FROM matches WHERE source_game_id=?").bind(`oracle:${row.gameId}`).first<{ id:number; blue_team_id:number|null; red_team_id:number|null }>();
    if (!match) { rejected++; continue; }
    await db.prepare(row.side === "blue" ? "UPDATE matches SET blue_team_id=? WHERE id=?" : "UPDATE matches SET red_team_id=? WHERE id=?").bind(team, match.id).run();
    if (row.isTeamRow) {
      await db.prepare("INSERT OR REPLACE INTO team_game_stats(match_id,team_id,side,won,kills,deaths,assists,gold,gold_per_minute,gold_diff_15,xp_diff_15,cs_diff_15,first_blood,first_tower,dragons,barons,heralds,towers) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(match.id,team,row.side,row.result,row.kills,row.deaths,row.assists,row.gold,row.goldPerMinute,row.goldDiff15,row.xpDiff15,row.csDiff15,row.firstBlood,row.firstTower,row.dragons,row.barons,row.heralds,row.towers).run();
    } else if (row.player) {
      await db.prepare("INSERT OR REPLACE INTO player_game_stats(match_id,team_id,player_name,role,champion,kills,deaths,assists,cs,gold,damage,vision_score) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(match.id,team,row.player,row.role,row.champion,row.kills,row.deaths,row.assists,row.cs,row.gold,row.damage,row.visionScore).run();
      if (row.champion) await db.prepare("INSERT OR IGNORE INTO drafts(match_id,team_id,phase,sequence_no,champion) VALUES(?,?,?,?,?)").bind(match.id,team,"pick",["TOP","JUNGLE","MID","BOT","SUPPORT"].indexOf((row.role ?? "").toUpperCase()) + 1,row.champion).run();
    }
    accepted++;
  }
  return { accepted, rejected };
}
