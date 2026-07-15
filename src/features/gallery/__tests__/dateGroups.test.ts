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
