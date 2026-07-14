import { by, device, element, waitFor } from 'detox';

// Generates raw App Store screenshots for each screen worth showcasing.
// Run against the ios.sim.screenshots.69 / .65 Detox configurations (see
// package.json "screenshots:ios:*" scripts) so files land pre-sized for the
// two App Store Connect display classes. Each `it` launches its own fresh
// instance rather than navigating back between screens, since iOS has no
// hardware back button for Detox to drive reliably.
//
// Caveat: the simulator has no real camera, so the camera-preview screen
// screenshot will show a black feed instead of live video -- swap that one
// for a photo taken on a physical device before submitting.

const SETTLE_MS = 500;

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
}

describe('App Store screenshots', () => {
  it('captures the onboarding and permissions screens', async () => {
    await device.launchApp({
      newInstance: true,
      delete: true,
      permissions: { camera: 'NO', photos: 'NO', microphone: 'NO', medialibrary: 'NO' },
    });

    await waitFor(element(by.id('onboarding-screen'))).toBeVisible().withTimeout(15000);
    await settle();
    await device.takeScreenshot('01-onboarding');

    await element(by.id('onboarding-skip')).tap();

    await waitFor(element(by.id('permissions-screen'))).toBeVisible().withTimeout(15000);
    await settle();
    await device.takeScreenshot('02-permissions');
  });

  it('captures the camera screen', async () => {
    await device.launchApp({
      newInstance: true,
      delete: true,
      permissions: { camera: 'YES', photos: 'YES', microphone: 'YES', medialibrary: 'YES' },
    });

    await waitFor(element(by.id('onboarding-screen'))).toBeVisible().withTimeout(15000);
    await element(by.id('onboarding-skip')).tap();

    await waitFor(element(by.id('camera-screen'))).toBeVisible().withTimeout(20000);
    await settle();
    await device.takeScreenshot('03-camera');
  });

  it('captures the settings screen', async () => {
    await device.launchApp({
      newInstance: true,
      delete: true,
      permissions: { camera: 'YES', photos: 'YES', microphone: 'YES', medialibrary: 'YES' },
    });

    await waitFor(element(by.id('onboarding-screen'))).toBeVisible().withTimeout(15000);
    await element(by.id('onboarding-skip')).tap();

    await waitFor(element(by.id('camera-screen'))).toBeVisible().withTimeout(20000);
    await element(by.id('open-settings')).tap();

    await waitFor(element(by.id('settings-screen'))).toBeVisible().withTimeout(10000);
    await settle();
    await device.takeScreenshot('04-settings');
  });

  it('captures the gallery screen', async () => {
    await device.launchApp({
      newInstance: true,
      delete: true,
      permissions: { camera: 'YES', photos: 'YES', microphone: 'YES', medialibrary: 'YES' },
    });

    await waitFor(element(by.id('onboarding-screen'))).toBeVisible().withTimeout(15000);
    await element(by.id('onboarding-skip')).tap();

    await waitFor(element(by.id('camera-screen'))).toBeVisible().withTimeout(20000);
    await element(by.id('open-gallery')).tap();

    await waitFor(element(by.id('gallery-screen'))).toBeVisible().withTimeout(10000);
    await settle();
    // Empty state, since there's no way to seed real recorded clips on the
    // simulator -- add a few clips manually beforehand to get a populated shot.
    await device.takeScreenshot('05-gallery');
  });
});
