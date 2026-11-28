import { Platform, Settings } from 'react-native';

/**
 * Store-asset demo mode (screenshots and App Preview footage on the
 * simulator, which has no camera).
 *
 * Only exists in debug builds: `__DEV__` is false in every Release build
 * (TestFlight, App Store, Play), so `DEMO_MODE` is the constant `false`
 * there and the minifier drops the demo branches. Even in a debug build it
 * stays off unless the app is launched with the `-pegueiDemo 1` launch
 * argument (`xcrun simctl launch <udid> <bundle> -pegueiDemo 1 -demoScene
 * <scene>`), which is how `scripts/store-assets.sh` drives it. iOS only:
 * launch arguments land in NSUserDefaults, read here through `Settings`.
 *
 * In demo mode the camera screen never touches the native circular buffer
 * (no camera session, no encoder, no buffer thread): it renders
 * DemoCameraPreview and a JS state machine instead. See docs in
 * marketing/README.md.
 */
export type DemoScene =
  | 'buffering'
  | 'recording'
  | 'wide'
  | 'story'
  | 'settings'
  | 'gallery'
  | 'clip'
  | 'export';

const SCENES: readonly DemoScene[] = ['buffering', 'recording', 'wide', 'story', 'settings', 'gallery', 'clip', 'export'];

function readLaunchArg(key: string): unknown {
  if (Platform.OS !== 'ios') return undefined;
  try {
    return Settings.get(key);
  } catch {
    return undefined;
  }
}

export function parseDemoScene(value: unknown): DemoScene {
  return SCENES.includes(value as DemoScene) ? (value as DemoScene) : 'buffering';
}

export const DEMO_MODE: boolean = __DEV__ && readLaunchArg('pegueiDemo') != null;

export const DEMO_SCENE: DemoScene | null = DEMO_MODE ? parseDemoScene(readLaunchArg('demoScene')) : null;

