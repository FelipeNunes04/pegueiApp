import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import {
  PERMISSIONS,
  RESULTS,
  check,
  request,
  type Permission,
} from 'react-native-permissions';
import type { PermissionKey, PermissionStatus } from '../../../shared/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { track, type PermissionName } from '../../../analytics';

type PermissionMap = Record<PermissionKey, PermissionStatus>;

const PERMISSION_NAME: Record<PermissionKey, PermissionName> = { camera: 'camera', microphone: 'mic' };
const PROMPT_COUNT_KEY = 'peguei:permissionPromptCount';

/** How many times the app asked for this permission, this one included. Kept on the phone. */
async function nextPromptCount(key: PermissionKey): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(PROMPT_COUNT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const counts = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    const current = typeof counts[key] === 'number' ? (counts[key] as number) : 0;
    const next = current + 1;
    await AsyncStorage.setItem(PROMPT_COUNT_KEY, JSON.stringify({ ...counts, [key]: next }));
    return next;
  } catch {
    return 1;
  }
}

function resolvePermission(key: PermissionKey): Permission | null {
  if (Platform.OS === 'android') {
    switch (key) {
      case 'camera':
        return PERMISSIONS.ANDROID.CAMERA;
      case 'microphone':
        return PERMISSIONS.ANDROID.RECORD_AUDIO;
    }
  }
  if (Platform.OS === 'ios') {
    switch (key) {
      case 'camera':
        return PERMISSIONS.IOS.CAMERA;
      case 'microphone':
        return PERMISSIONS.IOS.MICROPHONE;
    }
  }
  return null;
}

function toStatus(result: string): PermissionStatus {
  switch (result) {
    case RESULTS.GRANTED:
    case RESULTS.LIMITED:
      return 'granted';
    case RESULTS.BLOCKED:
      return 'blocked';
    case RESULTS.DENIED:
    case RESULTS.UNAVAILABLE:
      return 'denied';
    default:
      return 'unknown';
  }
}

// No storage/photos permission on either platform: clips live in app-private
// storage, and saving to Photos only happens through the system share sheet,
// which asks for access on its own (see DECISIONS.md, "saving to Photos").
const KEYS: PermissionKey[] = ['camera', 'microphone'];

export function usePermissions() {
  const [statuses, setStatuses] = useState<PermissionMap>({
    camera: 'unknown',
    microphone: 'unknown',
  });
  // False until the first refresh() resolves -- lets a caller (App.tsx)
  // avoid picking a navigator initialRouteName before it actually knows
  // whether permissions are already granted, which otherwise flashes the
  // Permissions screen for a frame even when there's nothing to ask for.
  const [checked, setChecked] = useState(false);

  const refresh = useCallback(async () => {
    const next: Partial<PermissionMap> = {};
    for (const key of KEYS) {
      const permission = resolvePermission(key);
      if (!permission) {
        next[key] = 'granted';
        continue;
      }
      const result = await check(permission);
      next[key] = toStatus(result);
    }
    setStatuses(prev => ({ ...prev, ...next }));
    setChecked(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const requestPermission = useCallback(async (key: PermissionKey): Promise<PermissionStatus> => {
    const permission = resolvePermission(key);
    if (!permission) {
      setStatuses(prev => ({ ...prev, [key]: 'granted' }));
      return 'granted';
    }
    const result = await request(permission);
    const status = toStatus(result);
    setStatuses(prev => ({ ...prev, [key]: status }));
    if (status === 'denied' || status === 'blocked') {
      track('permission_denied', { permission: key, status });
    }
    nextPromptCount(key)
      .then(count => track('permission_result', { permission: PERMISSION_NAME[key], granted: status === 'granted', prompt_count: count }))
      .catch(() => undefined);
    return status;
  }, []);

  const allGranted = KEYS.every(key => statuses[key] === 'granted');

  return { statuses, requestPermission, refresh, allGranted, checked };
}
