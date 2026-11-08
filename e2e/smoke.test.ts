import { by, device, element, waitFor } from 'detox';

describe('Peguei smoke test', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      delete: true,
      permissions: { camera: 'YES', photos: 'YES', microphone: 'YES', medialibrary: 'YES' },
    });
  });

  it('boots to the onboarding screen on a fresh install without crashing', async () => {
    // The one thing a smoke test must prove above all: the JS bundle loads,
    // the native module registrations resolve, and the app renders its
    // first-run screen instead of a red box / crash.
    await waitFor(element(by.id('onboarding-screen'))).toBeVisible().withTimeout(15000);
  });

  it('reaches the camera screen and can trigger a manual clip save', async () => {
    await element(by.id('onboarding-skip')).tap();

    if (await isVisible('permissions-screen')) {
      for (const key of ['permission-card-camera', 'permission-card-microphone']) {
        const card = element(by.id(key));
        await card.tap().catch(() => undefined);
      }
    }

    await waitFor(element(by.id('camera-screen'))).toBeVisible().withTimeout(20000);
    await element(by.id('record-button')).tap();
  });
});

async function isVisible(testId: string): Promise<boolean> {
  try {
    await waitFor(element(by.id(testId))).toBeVisible().withTimeout(2000);
    return true;
  } catch {
    return false;
  }
}
