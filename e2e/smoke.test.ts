import { by, device, element, waitFor } from 'detox';

describe('Peguei smoke test', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      permissions: { camera: 'YES', photos: 'YES', medialibrary: 'YES' },
    });
  });

  it('boots to either the permissions screen or the camera screen without crashing', async () => {
    // Whichever the target grants permissions upfront for, this is the
    // one thing a smoke test must prove above all: the JS bundle loads,
    // the native module registrations resolve, and the app renders one of
    // its two possible first screens instead of a red box / crash.
    await waitFor(element(by.id('permissions-screen')))
      .toBeVisible()
      .withTimeout(15000)
      .catch(() =>
        waitFor(element(by.id('camera-screen')))
          .toBeVisible()
          .withTimeout(15000),
      );
  });

  it('reaches the camera screen and can trigger a manual clip save', async () => {
    if (await isVisible('permissions-screen')) {
      for (const key of ['permission-card-camera', 'permission-card-storage']) {
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
