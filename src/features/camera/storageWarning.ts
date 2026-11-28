import { track } from '../../analytics';
import { canReportStorage, reportedStorageBucket, type DeviceStatus } from '../../analytics/deviceStatus';
import { setSessionStatusListener } from '../../analytics/fishingSession';
import { setUserProperties } from '../../analytics/track';
import { getConfigNumber, getFlag } from '../../config/remoteConfig';
import { useRecordingStore } from '../../shared/store/recordingStore';

/**
 * At the start of a fishing session: the `storage_free_bucket` user
 * property and, behind `storage_warning_enabled` (off by default), a notice
 * on the camera when free space is low. At most once per app run.
 *
 * The free space is read on both platforms but only sent on Android (on iOS
 * the disk space API may not send it off the phone; see docs/privacidade.md).
 */
let warned = false;

/** Text of the notice. Pure; exported for tests. */
export function storageWarningText(gb: number): string {
  const shown = gb < 1 ? gb.toFixed(1).replace('.', ',') : String(Math.floor(gb));
  return `Pouco espaço livre (${shown} GB). Libere espaço para não perder a próxima fisgada.`;
}

export function handleSessionStatus(status: DeviceStatus): void {
  setUserProperties({ storage_free_bucket: reportedStorageBucket(status.storageFreeGb) });
  if (warned || !getFlag('storage_warning_enabled')) return;
  const threshold = getConfigNumber('storage_warning_gb');
  if (status.storageFreeGb < 0 || status.storageFreeGb >= threshold) return;
  warned = true;
  useRecordingStore.getState().setNotice(storageWarningText(status.storageFreeGb));
  if (canReportStorage()) {
    track('storage_low_warning_shown', { storage_free_gb: status.storageFreeGb });
  }
}

export function installStorageWarning(): void {
  setSessionStatusListener(handleSessionStatus);
}

/** Tests only. */
export function resetStorageWarningForTests(): void {
  warned = false;
}
