import { by, device, element, expect, waitFor } from 'detox';

/**
 * First-launch onboarding: paging through every slide, finishing via
 * "Continuar", skipping via "Pular", and the "only shown once" guarantee
 * (onboardingStore persists the flag in AsyncStorage). Each scenario that
 * depends on first-launch state reinstalls (`delete: true`) so AsyncStorage
 * starts empty.
 *
 * Permissions are pre-granted in the "finish" scenarios, so after
 * onboarding the Permissions screen immediately forwards to Camera
 * (PermissionsScreen replaces itself once allGranted). Either screen counts
 * as "left onboarding" -- see waitForPostOnboardingScreen().
 */

const GRANTED = { camera: 'YES', photos: 'YES', microphone: 'YES', medialibrary: 'YES' } as const;
const DENIED = { camera: 'NO', photos: 'NO', microphone: 'NO', medialibrary: 'NO' } as const;

describe('Onboarding', () => {
  describe('paging with the "Próximo" button', () => {
    beforeAll(async () => {
      await device.launchApp({ newInstance: true, delete: true, permissions: GRANTED });
      await waitFor(element(by.id('onboarding-screen'))).toBeVisible().withTimeout(15000);
    });

    it('starts on the first slide with "Pular" and "Próximo" available', async () => {
      await expect(element(by.id('onboarding-slide-buffer'))).toBeVisible();
      await expect(element(by.id('onboarding-skip'))).toBeVisible();
      await expect(element(by.text('Próximo'))).toBeVisible();
    });

    it('advances one slide per tap', async () => {
      for (const slide of ['tap', 'versatility', 'welcome']) {
        await element(by.id('onboarding-next')).tap();
        await waitFor(element(by.id(`onboarding-slide-${slide}`)))
          .toBeVisible()
          .withTimeout(5000);
      }
    });

    it('on the last slide hides "Pular" and offers "Continuar"', async () => {
      await expect(element(by.id('onboarding-skip'))).not.toBeVisible();
      await expect(element(by.text('Continuar'))).toBeVisible();
    });

    it('"Continuar" leaves onboarding', async () => {
      await element(by.id('onboarding-next')).tap();
      await waitForPostOnboardingScreen();
      await expect(element(by.id('onboarding-screen'))).not.toExist();
    });

    it('is not shown again on the next launch', async () => {
      await device.launchApp({ newInstance: true });
      await waitForPostOnboardingScreen();
      await expect(element(by.id('onboarding-screen'))).not.toExist();
    });
  });

  describe('paging by swiping', () => {
    beforeAll(async () => {
      await device.launchApp({ newInstance: true, delete: true, permissions: GRANTED });
      await waitFor(element(by.id('onboarding-screen'))).toBeVisible().withTimeout(15000);
    });

    it('swiping left moves to the next slide and swiping right goes back', async () => {
      await element(by.id('onboarding-scroll')).swipe('left', 'fast', 0.75);
      await waitFor(element(by.id('onboarding-slide-tap'))).toBeVisible().withTimeout(5000);

      await element(by.id('onboarding-scroll')).swipe('right', 'fast', 0.75);
      await waitFor(element(by.id('onboarding-slide-buffer'))).toBeVisible().withTimeout(5000);
    });

    it('swiping to the last slide turns the button into "Continuar"', async () => {
      for (let i = 0; i < 3; i++) {
        await element(by.id('onboarding-scroll')).swipe('left', 'fast', 0.75);
      }
      await waitFor(element(by.id('onboarding-slide-welcome'))).toBeVisible().withTimeout(5000);
      await waitFor(element(by.text('Continuar'))).toBeVisible().withTimeout(5000);
      await expect(element(by.id('onboarding-skip'))).not.toBeVisible();
    });
  });

  describe('skipping', () => {
    it('"Pular" goes straight to the permissions screen when nothing is granted yet', async () => {
      await device.launchApp({ newInstance: true, delete: true, permissions: DENIED });
      await waitFor(element(by.id('onboarding-screen'))).toBeVisible().withTimeout(15000);

      await element(by.id('onboarding-skip')).tap();

      await waitFor(element(by.id('permissions-screen'))).toBeVisible().withTimeout(15000);
    });

    it('a skipped onboarding also counts as seen on the next launch', async () => {
      await device.launchApp({ newInstance: true });

      await waitFor(element(by.id('permissions-screen'))).toBeVisible().withTimeout(15000);
      await expect(element(by.id('onboarding-screen'))).not.toExist();
    });
  });
});

async function waitForPostOnboardingScreen(): Promise<void> {
  await waitFor(element(by.id('permissions-screen')))
    .toBeVisible()
    .withTimeout(15000)
    .catch(() =>
      waitFor(element(by.id('camera-screen'))).toBeVisible().withTimeout(15000),
    );
}
