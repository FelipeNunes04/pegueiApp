import { act, renderHook, waitFor } from '@testing-library/react-native';
import { check, request, RESULTS } from 'react-native-permissions';
import analytics from '@react-native-firebase/analytics';
import { usePermissions } from '../../src/hooks/usePermissions';

const mockedCheck = check as jest.Mock;
const mockedRequest = request as jest.Mock;
const mockedLogEvent = analytics().logEvent as jest.Mock;

describe('usePermissions', () => {
  beforeEach(() => {
    mockedCheck.mockReset();
    mockedRequest.mockReset();
  });

  it('reports allGranted once every permission checks as granted', async () => {
    mockedCheck.mockResolvedValue(RESULTS.GRANTED);
    const { result } = await renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.allGranted).toBe(true));
    expect(result.current.statuses.camera).toBe('granted');
    expect(result.current.statuses.storage).toBe('granted');
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
});
