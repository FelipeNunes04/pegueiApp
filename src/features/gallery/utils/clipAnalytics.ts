/** Whole days since the clip was saved, for video_deleted. Pure. */
export function clipAgeDays(createdAt: number, now: number = Date.now()): number {
  if (!Number.isFinite(createdAt) || createdAt <= 0 || createdAt > now) return 0;
  return Math.floor((now - createdAt) / (24 * 60 * 60 * 1000));
}

/** A clip deleted from the preview this soon after it was saved counts as a discarded capture. */
export const DISCARD_WINDOW_MS = 5 * 60 * 1000;

export function isFreshDiscard(createdAt: number, now: number = Date.now()): boolean {
  return createdAt > 0 && now - createdAt >= 0 && now - createdAt <= DISCARD_WINDOW_MS;
}

/** Seconds watched and whether the clip played to the end, for video_played. Pure. */
export function playedSummary(watchedS: number, durationS: number, reachedEnd: boolean): { duracao_s: number; completou: boolean } {
  const watched = Number.isFinite(watchedS) && watchedS > 0 ? watchedS : 0;
  return { duracao_s: Math.round(watched * 10) / 10, completou: reachedEnd || (durationS > 0 && watched >= durationS - 0.5) };
}
