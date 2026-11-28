import { listSavedClips } from '../shared/utils/files';
import { useRecordingStore } from '../shared/store/recordingStore';
import type { RootStackParamList } from '../shared/types';
import type { DemoScene } from './demoMode';

interface Navigator {
  navigate: (...args: never[]) => void;
}

const PUSH_DELAY_MS = 800;

/**
 * Opens the screen a demo scene is about, on top of Camera (so the header
 * and back button look like normal use). Clip scenes use the newest file in
 * PegueiClips, which store-assets.sh seeds with the placeholder (or real)
 * fishing clip.
 */
export async function runDemoNavigation(scene: DemoScene, nav: Navigator): Promise<void> {
  const go = nav.navigate as unknown as <K extends keyof RootStackParamList>(
    name: K,
    params?: RootStackParamList[K],
  ) => void;
  await new Promise(resolve => setTimeout(resolve, PUSH_DELAY_MS));
  if (scene === 'settings') {
    go('Settings');
    return;
  }
  if (scene === 'gallery' || scene === 'clip' || scene === 'export') {
    const clips = await listSavedClips().catch(() => []);
    useRecordingStore.getState().setClips(clips);
    go('Gallery');
    const newest = clips[0];
    if (!newest || scene === 'gallery') return;
    await new Promise(resolve => setTimeout(resolve, PUSH_DELAY_MS));
    go('ClipPreview', { clipId: newest.id });
    if (scene === 'export') {
      await new Promise(resolve => setTimeout(resolve, PUSH_DELAY_MS));
      go('ExportClip', { clipId: newest.id });
    }
  }
}
