import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import {
  PERMISSIONS,
  RESULTS,
  check,
  request,
  type Permission,
} from 'react-native-permissions';
import type { PermissionKey, PermissionStatus } from '../types';

type PermissionMap = Record<PermissionKey, PermissionStatus>;

function resolvePermission(key: PermissionKey): Permission | null {
  if (Platform.OS === 'android') {
    switch (key) {
      case 'camera':
        return PERMISSIONS.ANDROID.CAMERA;
      case 'storage':
        // Android 13+ (API 33) scoped media permissions; below that, WRITE_EXTERNAL_STORAGE.
        return Platform.Version >= 33 ? PERMISSIONS.ANDROID.READ_MEDIA_VIDEO : PERMISSIONS.ANDROID.WRITE_EXTERNAL_STORAGE;
    }
  }
  if (Platform.OS === 'ios') {
    switch (key) {
      case 'camera':
        return PERMISSIONS.IOS.CAMERA;
      case 'storage':
        return PERMISSIONS.IOS.PHOTO_LIBRARY_ADD_ONLY;
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

const KEYS: PermissionKey[] = ['camera', 'storage'];

export function usePermissions() {
  const [statuses, setStatuses] = useState<PermissionMap>({
    camera: 'unknown',
    storage: 'unknown',
  });

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
    return status;
  }, []);

  const allGranted = KEYS.every(key => statuses[key] === 'granted');

  return { statuses, requestPermission, refresh, allGranted };
}
