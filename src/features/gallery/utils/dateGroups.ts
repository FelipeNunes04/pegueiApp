import type { SavedClip } from '../../../shared/types';

const MONTH_NAMES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Hoje" / "Ontem" for the last two days, otherwise "12 de julho" (native-gallery convention). */
export function dateGroupTitle(createdAt: number, now: number = Date.now()): string {
  const date = new Date(createdAt);
  const today = new Date(now);
  if (isSameDay(date, today)) {
    return 'Hoje';
  }
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return 'Ontem';
  }
  return `${date.getDate()} de ${MONTH_NAMES_PT[date.getMonth()]}`;
}

export type GalleryListItem =
  | { type: 'header'; key: string; title: string }
  | { type: 'row'; key: string; clips: SavedClip[] };

/**
 * Flattens clips (assumed already sorted newest-first, see listSavedClips)
 * into a single array mixing date-group headers and fixed-width rows of
 * `numColumns` clips each -- rendered by a single virtualized FlatList
 * rather than a SectionList, since SectionList doesn't support numColumns
 * grid layout directly. The last row of a group is padded with `null`s (not
 * rendered) so its clips stay left-aligned instead of stretching.
 */
export function buildGalleryListItems(clips: SavedClip[], numColumns: number, now: number = Date.now()): GalleryListItem[] {
  const items: GalleryListItem[] = [];
  let currentGroupTitle: string | null = null;
  let currentRow: SavedClip[] = [];

  const flushRow = () => {
    if (currentRow.length > 0) {
      items.push({ type: 'row', key: `row-${items.length}-${currentRow[0].id}`, clips: currentRow });
      currentRow = [];
    }
  };

  for (const clip of clips) {
    const groupTitle = dateGroupTitle(clip.createdAt, now);
    if (groupTitle !== currentGroupTitle) {
      flushRow();
      items.push({ type: 'header', key: `header-${groupTitle}`, title: groupTitle });
      currentGroupTitle = groupTitle;
    }
    currentRow.push(clip);
    if (currentRow.length === numColumns) {
      flushRow();
    }
  }
  flushRow();

  return items;
}
