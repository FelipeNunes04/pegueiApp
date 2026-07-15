import analytics from '@react-native-firebase/analytics';
import {
  logClipDeleted,
  logClipSaved,
  logClipShared,
  logDonationPixCopied,
  logOnboardingCompleted,
  logOnboardingSkipped,
  logPermissionDenied,
} from '../utils/analytics';

const mockedLogEvent = analytics().logEvent as jest.Mock;

describe('analytics', () => {
  beforeEach(() => {
    mockedLogEvent.mockClear();
  });

  it('logClipSaved logs a rounded duration, not raw file/path data', () => {
    logClipSaved(12.7);
    expect(mockedLogEvent).toHaveBeenCalledWith('clip_saved', {
      duration_seconds: 13,
    });
  });

  it('logClipShared logs the shared count', () => {
    logClipShared(3);
    expect(mockedLogEvent).toHaveBeenCalledWith('clip_shared', { count: 3 });
  });

  it('logClipDeleted logs the deleted count', () => {
    logClipDeleted(2);
    expect(mockedLogEvent).toHaveBeenCalledWith('clip_deleted', { count: 2 });
  });

  it('logOnboardingCompleted and logOnboardingSkipped log distinct, argument-free events', () => {
    logOnboardingCompleted();
    expect(mockedLogEvent).toHaveBeenCalledWith('onboarding_completed');

    logOnboardingSkipped();
    expect(mockedLogEvent).toHaveBeenCalledWith('onboarding_skipped');
  });

  it('logPermissionDenied logs the permission key and status', () => {
    logPermissionDenied('camera', 'blocked');
    expect(mockedLogEvent).toHaveBeenCalledWith('permission_denied', {
      permission: 'camera',
      status: 'blocked',
    });
  });

  it('logDonationPixCopied logs an argument-free event', () => {
    logDonationPixCopied();
    expect(mockedLogEvent).toHaveBeenCalledWith('donation_pix_copied');
  });

  it('never throws even if the underlying analytics call rejects', async () => {
    mockedLogEvent.mockRejectedValueOnce(new Error('offline'));
    expect(() => logClipSaved(1)).not.toThrow();
  });
});
