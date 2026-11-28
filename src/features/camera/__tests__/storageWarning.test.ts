import * as RC from '@react-native-firebase/remote-config';
import { setUserProperties, track } from '../../../analytics/track';
import { UNKNOWN_STATUS } from '../../../analytics/deviceStatus';
import { useRecordingStore } from '../../../shared/store/recordingStore';
import { handleSessionStatus, resetStorageWarningForTests, storageWarningText } from '../storageWarning';

const setValues = (RC as unknown as { __setValues: (v: Record<string, unknown>) => void }).__setValues;

describe('storage warning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setValues({});
    resetStorageWarningForTests();
    useRecordingStore.setState({ noticeMessage: null });
  });

  it('is off by default: only the (iOS: not sent) bucket property', () => {
    handleSessionStatus({ ...UNKNOWN_STATUS, storageFreeGb: 0.8 });
    expect(useRecordingStore.getState().noticeMessage).toBeNull();
    expect(setUserProperties).toHaveBeenCalledWith({ storage_free_bucket: 'nao_enviado' });
  });

  it('warns once when switched on; on iOS the event is not sent', () => {
    setValues({ storage_warning_enabled: true });
    handleSessionStatus({ ...UNKNOWN_STATUS, storageFreeGb: 0.8 });
    handleSessionStatus({ ...UNKNOWN_STATUS, storageFreeGb: 0.5 });
    expect(useRecordingStore.getState().noticeMessage).toBe(storageWarningText(0.8));
    expect(track).not.toHaveBeenCalledWith('storage_low_warning_shown', expect.anything());
  });

  it('does nothing with enough space or an unknown reading', () => {
    setValues({ storage_warning_enabled: true });
    handleSessionStatus({ ...UNKNOWN_STATUS, storageFreeGb: 10 });
    handleSessionStatus(UNKNOWN_STATUS);
    expect(useRecordingStore.getState().noticeMessage).toBeNull();
  });

  it('text', () => {
    expect(storageWarningText(0.8)).toContain('0,8 GB');
    expect(storageWarningText(1.7)).toContain('1 GB');
  });
});
