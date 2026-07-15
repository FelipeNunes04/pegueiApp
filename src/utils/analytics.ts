import analytics from '@react-native-firebase/analytics';

// Screen views are logged automatically from App.tsx's navigation state
// listener -- these are the custom events worth a name of their own: signals
// for whether the app is actually doing its job, being adopted, and being
// supported, that don't fall out of automatic screen-view tracking.
export function logClipSaved(durationSeconds: number) {
  analytics()
    .logEvent('clip_saved', { duration_seconds: Math.round(durationSeconds) })
    .catch(() => undefined);
}

export function logClipShared(count: number) {
  analytics()
    .logEvent('clip_shared', { count })
    .catch(() => undefined);
}

export function logClipDeleted(count: number) {
  analytics()
    .logEvent('clip_deleted', { count })
    .catch(() => undefined);
}

export function logOnboardingCompleted() {
  analytics()
    .logEvent('onboarding_completed')
    .catch(() => undefined);
}

export function logOnboardingSkipped() {
  analytics()
    .logEvent('onboarding_skipped')
    .catch(() => undefined);
}

export function logPermissionDenied(permission: string, status: 'denied' | 'blocked') {
  analytics()
    .logEvent('permission_denied', { permission, status })
    .catch(() => undefined);
}

export function logDonationPixCopied() {
  analytics()
    .logEvent('donation_pix_copied')
    .catch(() => undefined);
}
