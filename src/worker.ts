export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type TeamRow = { id: number; name: string; games: number; wins: number; win_rate: number; gd15: number; xp15: number; cs15: number; kd: number; first_blood: number; first_tower: number; dragon_rate: number; baron_rate: number; vision: number; blue_rate: number; red_rate: number };

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });

async function teamStats(db: D1Database, teamId: number): Promise<TeamRow | null> {
  return db.prepare(`
    SELECT t.id, t.name, COUNT(s.match_id) games, SUM(s.won) wins,
      AVG(s.won) win_rate, AVG(s.gold_diff_15) gd15, AVG(s.xp_diff_15) xp15,
      AVG(s.cs_diff_15) cs15, AVG(s.kills - s.deaths) kd,
      AVG(s.first_blood) first_blood, AVG(s.first_tower) first_tower,
      AVG(s.dragons) / NULLIF(AVG(s.dragons) + AVG(CASE WHEN s.dragons IS NOT NULL THEN 1 END), 0) dragon_rate,
      AVG(s.barons) / NULLIF(AVG(s.barons) + AVG(CASE WHEN s.barons IS NOT NULL THEN 1 END), 0) baron_rate,
      AVG(s.vision_score_per_minute) vision,
      AVG(CASE WHEN s.side='blue' THEN s.won END) blue_rate,
      AVG(CASE WHEN s.side='red' THEN s.won END) red_rate
    FROM teams t JOIN team_game_stats s ON s.team_id=t.id
    WHERE t.id=? GROUP BY t.id, t.name
  `).bind(teamId).first<TeamRow>();
}

function edge(a: number | null, b: number | null) {
  if (a == null || b == null) return null;
  return (a - b) / (Math.abs(a) + Math.abs(b) + (a === 0 || b === 0 ? 1 : 0));
}

function probability(a: TeamRow, b: TeamRow) {
  const metrics = [
    ["Win rate", a.win_rate, b.win_rate, 0.25], ["Gold diff @15", a.gd15, b.gd15, 0.16],
    ["XP diff @15", a.xp15, b.xp15, 0.10], ["CS diff @15", a.cs15, b.cs15, 0.08],
    ["Kill-death diff", a.kd, b.kd, 0.12], ["First blood", a.first_blood, b.first_blood, 0.08],
    ["First tower", a.first_tower, b.first_tower, 0.07], ["Vision / min", a.vision, b.vision, 0.06],
    ["Blue/red side", ((a.blue_rate ?? 0) + (a.red_rate ?? 0)) / 2, ((b.blue_rate ?? 0) + (b.red_rate ?? 0)) / 2, 0.08]
  ] as const;
  const supported = metrics.map(([name, av, bv, weight]) => ({ name, edge: edge(av, bv), weight }));
  const activeWeight = supported.reduce((sum, x) => sum + (x.edge == null ? 0 : x.weight), 0);
  const score = activeWeight ? supported.reduce((sum, x) => sum + (x.edge == null ? 0 : x.edge * x.weight / activeWeight), 0) * 2.4 : 0;
  return { teamA: a.name, teamB: b.name, probabilityA: 1 / (1 + Math.exp(-score)), probabilityB: 1 - 1 / (1 + Math.exp(-score)), confidence: Math.min(1, Math.min(a.games, b.games) / 20) * activeWeight, activeWeight, factors: supported };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ ok: true });
    if (url.pathname === "/api/teams") {
      const { results } = await env.DB.prepare("SELECT id, name, region FROM teams ORDER BY name").all();
      return json(results);
    }
    if (url.pathname === "/api/matchup") {
      const a = Number(url.searchParams.get("teamA")); const b = Number(url.searchParams.get("teamB"));
      if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return json({ error: "Select two different teams." }, 400);
      const [teamA, teamB] = await Promise.all([teamStats(env.DB, a), teamStats(env.DB, b)]);
      if (!teamA || !teamB) return json({ error: "Both teams need imported game statistics." }, 404);
      return json(probability(teamA, teamB));
    }
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
