import { shareDestination } from '../utils/shareDestination';

describe('shareDestination', () => {
  it.each([
    ['net.whatsapp.WhatsApp.ShareExtension', 'whatsapp'],
    ['com.whatsapp/com.whatsapp.ContactPicker', 'whatsapp'],
    ['com.burbn.instagram.shareextension', 'instagram'],
    ['com.instagram.android/com.instagram.share.handleractivity.ShareHandlerActivity', 'instagram'],
    ['com.zhiliaoapp.musically.ShareExtension', 'tiktok'],
    ['com.ss.android.ugc.trill/com.ss.android.ugc.aweme.share.SystemShareActivity', 'tiktok'],
    ['com.google.ios.youtube.ShareExtension', 'youtube'],
    ['com.facebook.katana/com.facebook.composer.shareintent.ImplicitShareIntentHandler', 'facebook'],
    ['com.apple.UIKit.activity.AirDrop', 'outro'],
    ['', 'outro'],
  ])('%s -> %s', (message, expected) => {
    expect(shareDestination({ success: true, message })).toBe(expected);
  });

  it('reports a dismissed or failed share as cancelado', () => {
    expect(shareDestination({ success: false, dismissedAction: true, message: '' })).toBe('cancelado');
    expect(shareDestination({ success: false, message: 'net.whatsapp.WhatsApp.ShareExtension' })).toBe('cancelado');
    expect(shareDestination(undefined)).toBe('cancelado');
  });
});
