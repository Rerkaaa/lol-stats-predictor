export type EloMatch = { matchId: number; playedAt: string | null; teamId: number; won: number };
export type EloSignal = { leftRating: number; rightRating: number; probabilityA: number };

const BASE_RATING = 1500;
const K_FACTOR = 24;
const DAY = 86_400_000;

const when = (value: string | null) => {
  if (!value) return 0;
  const timestamp = Date.parse(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export function opponentAdjustedElo(rows: EloMatch[], leftId: number, rightId: number): EloSignal {
  const byMatch = new Map<number, EloMatch[]>();
  for (const row of rows) byMatch.set(row.matchId, [...(byMatch.get(row.matchId) ?? []), row]);
  const ratings = new Map<number, number>();
  const lastPlayed = new Map<number, number>();
  const rating = (teamId: number) => ratings.get(teamId) ?? BASE_RATING;

  for (const [, match] of [...byMatch.entries()].sort(([, a], [, b]) => when(a[0]?.playedAt ?? null) - when(b[0]?.playedAt ?? null))) {
    if (match.length !== 2) continue;
    const [left, right] = match;
    const timestamp = when(left.playedAt);
    for (const teamId of [left.teamId, right.teamId]) {
      const previous = lastPlayed.get(teamId);
      if (previous && timestamp > previous) {
        const days = (timestamp - previous) / DAY;
        ratings.set(teamId, BASE_RATING + (rating(teamId) - BASE_RATING) * 0.5 ** (days / 180));
      }
      lastPlayed.set(teamId, timestamp);
    }
    const leftRating = rating(left.teamId), rightRating = rating(right.teamId);
    const expectedLeft = 1 / (1 + 10 ** ((rightRating - leftRating) / 400));
    ratings.set(left.teamId, leftRating + K_FACTOR * (left.won - expectedLeft));
    ratings.set(right.teamId, rightRating + K_FACTOR * (right.won - (1 - expectedLeft)));
  }

  const leftRating = rating(leftId), rightRating = rating(rightId);
  return { leftRating, rightRating, probabilityA: 1 / (1 + 10 ** ((rightRating - leftRating) / 400)) };
}
