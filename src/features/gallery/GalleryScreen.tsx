import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Share from 'react-native-share';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ClipGridThumbnail } from './components/ClipGridThumbnail';
import { GalleryEmptyState } from './components/GalleryEmptyState';
import { SelectionToolbar } from './components/SelectionToolbar';
import { DeleteConfirmModal } from '../../shared/components/DeleteConfirmModal';
import { buildGalleryListItems, type GalleryListItem } from './utils/dateGroups';
import { deleteClip, listSavedClips } from '../../shared/utils/files';
import { logClipDeleted, logClipShared } from '../../shared/utils/analytics';
import { useRecordingStore } from '../../shared/store/recordingStore';
import { colors } from '../../shared/theme/colors';
import { typography } from '../../shared/theme/typography';
import type { RootStackParamList, SavedClip } from '../../shared/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Gallery'>;

const WIDE_LAYOUT_BREAKPOINT = 700;

function toFilePath(clip: SavedClip): string {
  return clip.path.startsWith('file://') ? clip.path : `file://${clip.path}`;
}

// Defined outside GalleryScreen (rather than inline in the headerLeft
// factory) so react-navigation's header doesn't see a new component type on
// every render -- that would remount the button on every state change.
function SelectionCancelButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" testID="selection-cancel" onPress={onPress}>
      <Text style={styles.headerAction}>Cancelar</Text>
    </Pressable>
  );
}

export function GalleryScreen({ navigation }: Props) {
  const clips = useRecordingStore(s => s.clips);
  const setClips = useRecordingStore(s => s.setClips);
  const removeClip = useRecordingStore(s => s.removeClip);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const { width } = useWindowDimensions();

  const selectionMode = selectedIds.size > 0;
  const numColumns = width >= WIDE_LAYOUT_BREAKPOINT ? 3 : 2;
  const cellSize = Math.floor(width / numColumns) - 2;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const found = await listSavedClips();
      setClips(found);
    } finally {
      setLoading(false);
    }
  }, [setClips]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const exitSelectionMode = useCallback(() => setSelectedIds(new Set()), []);
  const renderSelectionCancelButton = useCallback(
    () => <SelectionCancelButton onPress={exitSelectionMode} />,
    [exitSelectionMode],
  );

  useLayoutEffect(() => {
    if (selectionMode) {
      navigation.setOptions({
        title: selectedIds.size === 1 ? '1 selecionado' : `${selectedIds.size} selecionados`,
        headerLeft: renderSelectionCancelButton,
      });
    } else {
      navigation.setOptions({ title: 'Galeria', headerLeft: undefined });
    }
  }, [navigation, selectionMode, selectedIds.size, renderSelectionCancelButton]);

  const handleLongPress = useCallback((clip: SavedClip) => {
    setSelectedIds(prev => new Set(prev).add(clip.id));
  }, []);

  const handlePress = useCallback(
    (clip: SavedClip) => {
      if (selectionMode) {
        setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(clip.id)) {
            next.delete(clip.id);
          } else {
            next.add(clip.id);
          }
          return next;
        });
        return;
      }
      navigation.navigate('ClipPreview', { clipId: clip.id });
    },
    [selectionMode, navigation],
  );

  const selectedClips = useMemo(() => clips.filter(c => selectedIds.has(c.id)), [clips, selectedIds]);

  const handleShareSelected = useCallback(() => {
    const count = selectedClips.length;
    const share =
      count === 1
        ? Share.open({ url: toFilePath(selectedClips[0]), type: 'video/mp4' })
        : Share.open({ urls: selectedClips.map(toFilePath) });
    share.then(() => logClipShared(count)).catch(() => undefined);
  }, [selectedClips]);

  const handleDeleteSelected = useCallback(() => {
    setPendingDeleteIds(Array.from(selectedIds));
  }, [selectedIds]);

  const confirmDelete = useCallback(async () => {
    const ids = pendingDeleteIds ?? [];
    setPendingDeleteIds(null);
    const toDelete = clips.filter(c => ids.includes(c.id));
    await Promise.all(toDelete.map(c => deleteClip(c.path)));
    ids.forEach(id => removeClip(id));
    logClipDeleted(ids.length);
    setSelectedIds(new Set());
  }, [pendingDeleteIds, clips, removeClip]);

  const listItems = useMemo(() => buildGalleryListItems(clips, numColumns), [clips, numColumns]);

  const renderItem = useCallback(
    ({ item }: { item: GalleryListItem }) => {
      if (item.type === 'header') {
        return <Text style={styles.sectionHeader}>{item.title}</Text>;
      }
      return (
        <View style={styles.row}>
          {item.clips.map(clip => (
            <ClipGridThumbnail
              key={clip.id}
              clip={clip}
              size={cellSize}
              selectionMode={selectionMode}
              selected={selectedIds.has(clip.id)}
              onPress={handlePress}
              onLongPress={handleLongPress}
            />
          ))}
        </View>
      );
    },
    [cellSize, selectionMode, selectedIds, handlePress, handleLongPress],
  );

  return (
    <View style={styles.container} testID="gallery-screen">
      {!loading && clips.length === 0 ? (
        <GalleryEmptyState onBackToCamera={() => navigation.navigate('Camera')} />
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={item => item.key}
          renderItem={renderItem}
          onRefresh={refresh}
          refreshing={loading}
          // Rows/headers are pre-chunked in buildGalleryListItems rather
          // than using FlatList's own `numColumns`, since numColumns can't
          // mix full-width date headers with a fixed-column grid in the
          // same list -- see the comment there. This still gets the same
          // virtualization (only visible rows are mounted).
          removeClippedSubviews
        />
      )}

      {selectionMode && (
        <SelectionToolbar count={selectedIds.size} onShare={handleShareSelected} onDelete={handleDeleteSelected} />
      )}

      <DeleteConfirmModal
        visible={pendingDeleteIds !== null}
        count={pendingDeleteIds?.length ?? 0}
        onCancel={() => setPendingDeleteIds(null)}
        onConfirm={confirmDelete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDark },
  sectionHeader: { ...typography.bodyStrong, color: colors.textDark, paddingHorizontal: 8, paddingTop: 16, paddingBottom: 8 },
  row: { flexDirection: 'row' },
  headerAction: { ...typography.bodyStrong, color: colors.accent, paddingHorizontal: 8 },
});
