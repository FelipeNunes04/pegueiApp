import type { ShareDestino } from '../../../analytics';

/**
 * Turns what the share sheet reports into a destination for analytics.
 * react-native-share resolves `message` with the iOS `activityType` (from
 * UIActivityViewController.completionWithItemsHandler) or, on Android, the
 * component picked in the chooser (Intent.createChooser + IntentSender ->
 * EXTRA_CHOSEN_COMPONENT), e.g. "com.whatsapp/com.whatsapp.ContactPicker".
 */
const DESTINATIONS: Array<[RegExp, ShareDestino]> = [
  [/whatsapp/i, 'whatsapp'],
  [/instagram|burbn/i, 'instagram'],
  // TikTok's bundle and package ids: com.zhiliaoapp.musically, com.ss.android.ugc.trill
  [/tiktok|musically|ugc\.trill|ugc\.aweme/i, 'tiktok'],
  [/youtube/i, 'youtube'],
  [/facebook|katana/i, 'facebook'],
];

export function shareDestination(result: { success?: boolean; dismissedAction?: boolean; message?: string } | undefined): ShareDestino {
  if (!result || result.dismissedAction || result.success === false) return 'cancelado';
  const target = result.message ?? '';
  for (const [pattern, destino] of DESTINATIONS) {
    if (pattern.test(target)) return destino;
  }
  return 'outro';
}
