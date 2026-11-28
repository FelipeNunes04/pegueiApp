import { clipAgeDays, DISCARD_WINDOW_MS, isFreshDiscard, playedSummary } from '../utils/clipAnalytics';

describe('clip analytics helpers', () => {
  const day = 24 * 60 * 60 * 1000;
  it('age in whole days', () => {
    expect(clipAgeDays(1000, 1000 + 3 * day + 5)).toBe(3);
    expect(clipAgeDays(0, 1000)).toBe(0);
    expect(clipAgeDays(5000, 1000)).toBe(0);
  });
  it('a fresh delete is a discarded capture', () => {
    expect(isFreshDiscard(1000, 1000 + DISCARD_WINDOW_MS)).toBe(true);
    expect(isFreshDiscard(1000, 1000 + DISCARD_WINDOW_MS + 1)).toBe(false);
  });
  it('played summary', () => {
    expect(playedSummary(4.26, 10, false)).toEqual({ duracao_s: 4.3, completou: false });
    expect(playedSummary(9.8, 10, false)).toEqual({ duracao_s: 9.8, completou: true });
    expect(playedSummary(0, 10, true)).toEqual({ duracao_s: 0, completou: true });
  });
});
