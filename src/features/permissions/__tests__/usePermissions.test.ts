import { Platform } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { check, PERMISSIONS, request, RESULTS } from 'react-native-permissions';
import analytics from '@react-native-firebase/analytics';
import { usePermissions } from '../hooks/usePermissions';

const mockedCheck = check as jest.Mock;
const mockedRequest = request as jest.Mock;
const mockedLogEvent = analytics().logEvent as jest.Mock;

describe('usePermissions', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    mockedCheck.mockReset();
    mockedRequest.mockReset();
    mockedLogEvent.mockClear();
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('reports allGranted once every permission checks as granted', async () => {
    mockedCheck.mockResolvedValue(RESULTS.GRANTED);
    const { result } = await renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.allGranted).toBe(true));
    expect(result.current.statuses.camera).toBe('granted');
    expect(result.current.statuses.microphone).toBe('granted');
  });

  it('reports denied permissions individually and keeps allGranted false', async () => {
    mockedCheck.mockImplementation(async (permission: string) =>
      permission.toLowerCase().includes('camera') ? RESULTS.DENIED : RESULTS.GRANTED,
    );
    const { result } = await renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.statuses.camera).toBe('denied'));
    expect(result.current.allGranted).toBe(false);
  });

  it('maps a BLOCKED result to the "blocked" status', async () => {
    mockedCheck.mockResolvedValue(RESULTS.BLOCKED);
    const { result } = await renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.statuses.camera).toBe('blocked'));
  });

  it('requestPermission updates the status for just that key', async () => {
    mockedCheck.mockResolvedValue(RESULTS.DENIED);
    mockedRequest.mockResolvedValue(RESULTS.GRANTED);
    const { result } = await renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.statuses.camera).toBe('denied'));

    await act(async () => {
      await result.current.requestPermission('camera');
    });

    expect(result.current.statuses.camera).toBe('granted');
    expect(mockedLogEvent).not.toHaveBeenCalledWith('permission_denied', expect.anything());
  });

  it('logs permission_denied when a request comes back denied', async () => {
    mockedCheck.mockResolvedValue(RESULTS.DENIED);
    mockedRequest.mockResolvedValue(RESULTS.BLOCKED);
    const { result } = await renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.statuses.camera).toBe('denied'));

    await act(async () => {
      await result.current.requestPermission('camera');
    });

    expect(mockedLogEvent).toHaveBeenCalledWith('permission_denied', { permission: 'camera', status: 'blocked' });
  });

  describe.each([
    ['android', PERMISSIONS.ANDROID.CAMERA, PERMISSIONS.ANDROID.RECORD_AUDIO],
    ['ios', PERMISSIONS.IOS.CAMERA, PERMISSIONS.IOS.MICROPHONE],
  ] as const)('on %s', (os, camera, microphone) => {
    beforeEach(() => {
      Platform.OS = os;
    });

    it('checks only the camera and the microphone', async () => {
      mockedCheck.mockResolvedValue(RESULTS.GRANTED);
      const { result } = await renderHook(() => usePermissions());

      await waitFor(() => expect(result.current.checked).toBe(true));

      expect(mockedCheck.mock.calls.map(([permission]) => permission)).toEqual([camera, microphone]);
      expect(result.current.allGranted).toBe(true);
    });

    it('requests the matching native permission', async () => {
      mockedCheck.mockResolvedValue(RESULTS.DENIED);
      mockedRequest.mockResolvedValue(RESULTS.GRANTED);
      const { result } = await renderHook(() => usePermissions());
      await waitFor(() => expect(result.current.checked).toBe(true));

      await act(async () => {
        await result.current.requestPermission('camera');
      });
      await act(async () => {
        await result.current.requestPermission('microphone');
      });

      expect(mockedRequest.mock.calls.map(([permission]) => permission)).toEqual([camera, microphone]);
      expect(result.current.allGranted).toBe(true);
    });
  });

  it('never asks for a storage/media permission', async () => {
    for (const os of ['android', 'ios'] as const) {
      Platform.OS = os;
      mockedCheck.mockResolvedValue(RESULTS.GRANTED);
      const { result, unmount } = await renderHook(() => usePermissions());
      await waitFor(() => expect(result.current.checked).toBe(true));
      await unmount();
    }

    const asked = mockedCheck.mock.calls.map(([permission]) => String(permission));
    expect(asked.filter(permission => /MEDIA|STORAGE|PHOTO/i.test(permission))).toEqual([]);
  });

  it.each([
    [RESULTS.LIMITED, 'granted'],
    [RESULTS.UNAVAILABLE, 'denied'],
    ['something-new', 'unknown'],
  ])('maps a %s result to "%s"', async (nativeResult, status) => {
    mockedCheck.mockResolvedValue(nativeResult);
    const { result } = await renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.statuses.camera).toBe(status));
  });

  it('refresh() picks up a permission revoked in system settings', async () => {
    mockedCheck.mockResolvedValue(RESULTS.GRANTED);
    const { result } = await renderHook(() => usePermissions());
    await waitFor(() => expect(result.current.allGranted).toBe(true));

    mockedCheck.mockResolvedValue(RESULTS.BLOCKED);
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.statuses.camera).toBe('blocked');
    expect(result.current.statuses.microphone).toBe('blocked');
    expect(result.current.allGranted).toBe(false);
  });

  it('logs a request that comes back denied, keeping the status', async () => {
    mockedCheck.mockResolvedValue(RESULTS.DENIED);
    mockedRequest.mockResolvedValue(RESULTS.DENIED);
    const { result } = await renderHook(() => usePermissions());
    await waitFor(() => expect(result.current.checked).toBe(true));

    let status;
    await act(async () => {
      status = await result.current.requestPermission('microphone');
    });

    expect(status).toBe('denied');
    expect(mockedLogEvent).toHaveBeenCalledWith('permission_denied', { permission: 'microphone', status: 'denied' });
  });

  describe('on a platform with no runtime permissions', () => {
    beforeEach(() => {
      Platform.OS = 'web';
    });

    it('treats everything as granted without asking native', async () => {
      const { result } = await renderHook(() => usePermissions());

      await waitFor(() => expect(result.current.allGranted).toBe(true));
      expect(mockedCheck).not.toHaveBeenCalled();
    });

    it('requestPermission() resolves granted without asking native', async () => {
      const { result } = await renderHook(() => usePermissions());
      await waitFor(() => expect(result.current.checked).toBe(true));

      let status;
      await act(async () => {
        status = await result.current.requestPermission('camera');
      });

      expect(status).toBe('granted');
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });
});
