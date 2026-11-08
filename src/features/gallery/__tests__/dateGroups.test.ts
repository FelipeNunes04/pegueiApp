import { buildGalleryListItems, dateGroupTitle } from '../utils/dateGroups';
import type { SavedClip } from '../../../shared/types';

const NOW = new Date(2026, 6, 15, 12, 0).getTime(); // 2026-07-15 12:00 local

const makeClip = (id: string, createdAt: number): SavedClip => ({
  id,
  path: `/clips/${id}.mp4`,
  createdAt,
  durationSeconds: 5,
  triggeredBy: 'manual',
});

describe('dateGroupTitle', () => {
  it('labels the same calendar day as "Hoje"', () => {
    const today = new Date(2026, 6, 15, 8, 0).getTime();
    expect(dateGroupTitle(today, NOW)).toBe('Hoje');
  });

  it('labels the previous calendar day as "Ontem"', () => {
    const yesterday = new Date(2026, 6, 14, 23, 0).getTime();
    expect(dateGroupTitle(yesterday, NOW)).toBe('Ontem');
  });

  it('labels older dates as "<day> de <month>" in Portuguese', () => {
    const older = new Date(2026, 6, 1, 10, 0).getTime();
    expect(dateGroupTitle(older, NOW)).toBe('1 de julho');
  });
});

describe('buildGalleryListItems', () => {
  it('groups clips under one header per day and chunks rows to numColumns', () => {
    const clips = [
      makeClip('a', new Date(2026, 6, 15, 10, 0).getTime()),
      makeClip('b', new Date(2026, 6, 15, 9, 0).getTime()),
      makeClip('c', new Date(2026, 6, 15, 8, 0).getTime()),
      makeClip('d', new Date(2026, 6, 14, 20, 0).getTime()),
    ];

    const items = buildGalleryListItems(clips, 2, NOW);

    expect(items.map(i => i.type)).toEqual([
      'header',
      'row',
      'row',
      'header',
      'row',
    ]);
    expect(items[0]).toMatchObject({ type: 'header', title: 'Hoje' });
    expect(items[1]).toMatchObject({
      type: 'row',
      clips: [clips[0], clips[1]],
    });
    expect(items[2]).toMatchObject({ type: 'row', clips: [clips[2]] });
    expect(items[3]).toMatchObject({ type: 'header', title: 'Ontem' });
    expect(items[4]).toMatchObject({ type: 'row', clips: [clips[3]] });
  });

  it('returns an empty list for no clips', () => {
    expect(buildGalleryListItems([], 2, NOW)).toEqual([]);
  });
});

describe('dateGroups defaults to the current time', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('dateGroupTitle uses Date.now() when no reference time is passed', () => {
    expect(dateGroupTitle(new Date(2026, 6, 15, 1, 0).getTime())).toBe('Hoje');
    expect(dateGroupTitle(new Date(2026, 6, 14, 1, 0).getTime())).toBe('Ontem');
  });

  it('buildGalleryListItems uses Date.now() when no reference time is passed', () => {
    const items = buildGalleryListItems(
      [makeClip('a', new Date(2026, 6, 15, 9, 0).getTime())],
      3,
    );

    expect(items[0]).toMatchObject({ type: 'header', title: 'Hoje' });
  });
});

describe('dateGroupTitle edge cases', () => {
  it('treats the last day of the previous month as "Ontem" on the 1st', () => {
    const firstOfAugust = new Date(2026, 7, 1, 9, 0).getTime();
    const lastOfJuly = new Date(2026, 6, 31, 22, 0).getTime();

    expect(dateGroupTitle(lastOfJuly, firstOfAugust)).toBe('Ontem');
  });

  it('does not call the same day/month of a different year "Hoje"', () => {
    const lastYear = new Date(2025, 6, 15, 12, 0).getTime();

    expect(dateGroupTitle(lastYear, NOW)).toBe('15 de julho');
  });

  it('uses the correct Portuguese month names at both ends of the year', () => {
    expect(dateGroupTitle(new Date(2026, 0, 3).getTime(), NOW)).toBe('3 de janeiro');
    expect(dateGroupTitle(new Date(2025, 11, 25).getTime(), NOW)).toBe('25 de dezembro');
  });
});

describe('buildGalleryListItems row keys', () => {
  it('produces unique keys for every header and row', () => {
    const clips = Array.from({ length: 7 }, (_, i) =>
      makeClip(`c${i}`, new Date(2026, 6, 15 - Math.floor(i / 3), 10, 0).getTime()),
    );

    const items = buildGalleryListItems(clips, 2, NOW);
    const keys = items.map(i => i.key);

    expect(new Set(keys).size).toBe(keys.length);
  });
});
