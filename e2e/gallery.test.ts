import { by, device, element, expect, waitFor } from 'detox';

/**
 * Gallery navigation: Camera -> Gallery (empty state) -> back to Camera,
 * then -- when a clip can actually be recorded -- grid -> preview -> back,
 * and multi-select enter/exit.
 *
 * Simulators have no real back camera, so recording a clip may not produce
 * a file there (same caveat as smoke.test.ts/settings.test.ts). The
 * empty-state flow is asserted unconditionally on a fresh install; the
 * clip-dependent flows are asserted only if a clip actually shows up in the
 * grid, and otherwise log why they were not exercised. Run on a physical
 * device for full coverage of those.
 */

const GRANTED = { camera: 'YES', photos: 'YES', microphone: 'YES', medialibrary: 'YES' } as const;
const CLIP_CELL = /^clip-clip_\d+(_d\d+)?\.(mp4|mov)$/;

describe('Gallery navigation', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true, delete: true, permissions: GRANTED });
    await waitFor(element(by.id('onboarding-screen'))).toBeVisible().withTimeout(15000);
    await element(by.id('onboarding-skip')).tap();
    await waitFor(element(by.id('camera-screen'))).toBeVisible().withTimeout(20000);
  });

  it('opens the gallery from the camera and shows the empty state on a fresh install', async () => {
    await expect(element(by.id('gallery-thumbnail-placeholder'))).toBeVisible();

    await element(by.id('open-gallery')).tap();

    await waitFor(element(by.id('gallery-screen'))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.id('gallery-empty'))).toBeVisible().withTimeout(10000);
    await expect(element(by.text('Nenhum clipe salvo ainda'))).toBeVisible();
  });

  it('the empty-state CTA returns to the camera', async () => {
    await element(by.id('gallery-empty-cta')).tap();

    await waitFor(element(by.id('camera-screen'))).toBeVisible().withTimeout(10000);
  });

  describe('with a recorded clip (physical device / camera-capable simulator only)', () => {
    let hasClip = false;

    beforeAll(async () => {
      await element(by.id('record-button')).tap().catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 2500));
      await element(by.id('record-button')).tap().catch(() => undefined);

      await element(by.id('open-gallery')).tap();
      await waitFor(element(by.id('gallery-screen'))).toBeVisible().withTimeout(10000);
      hasClip = await isVisible(CLIP_CELL, 5000);
      if (!hasClip) {
        console.warn(
          '[gallery.test] No clip was saved (expected on a simulator without a camera); ' +
            'skipping grid/preview/selection assertions.',
        );
      }
    });

    it('shows the clip under a "Hoje" date header', async () => {
      if (!hasClip) return;
      await expect(element(by.text('Hoje'))).toBeVisible();
    });

    it('tapping a clip opens the full-screen preview and the back button returns to the grid', async () => {
      if (!hasClip) return;
      await element(by.id(CLIP_CELL)).atIndex(0).tap();
      await waitFor(element(by.id('clip-preview-screen'))).toBeVisible().withTimeout(10000);
      await expect(element(by.id('preview-play-pause'))).toBeVisible();
      await expect(element(by.id('preview-seek-slider'))).toBeVisible();

      await element(by.id('preview-play-pause')).tap();

      await element(by.id('preview-back')).tap();
      await waitFor(element(by.id('gallery-screen'))).toBeVisible().withTimeout(10000);
    });

    it('the preview delete asks for confirmation and cancelling keeps the clip', async () => {
      if (!hasClip) return;
      await element(by.id(CLIP_CELL)).atIndex(0).tap();
      await waitFor(element(by.id('clip-preview-screen'))).toBeVisible().withTimeout(10000);

      await element(by.id('preview-delete')).tap();
      await waitFor(element(by.text('Excluir vídeo?'))).toBeVisible().withTimeout(5000);
      await element(by.id('delete-confirm-cancel')).tap();

      await expect(element(by.id('clip-preview-screen'))).toBeVisible();
      await element(by.id('preview-back')).tap();
      await waitFor(element(by.id(CLIP_CELL)).atIndex(0)).toBeVisible().withTimeout(10000);
    });

    it('long-pressing a clip enters selection mode; "Cancelar" exits it', async () => {
      if (!hasClip) return;
      await element(by.id(CLIP_CELL)).atIndex(0).longPress();
      await waitFor(element(by.id('selection-toolbar'))).toBeVisible().withTimeout(5000);
      await expect(element(by.text('1 selecionado'))).toBeVisible();

      await element(by.id('selection-cancel')).tap();
      await waitFor(element(by.id('selection-toolbar'))).not.toBeVisible().withTimeout(5000);
      await expect(element(by.text('Galeria'))).toBeVisible();
    });

    it('the camera gallery button shows the last clip thumbnail after returning', async () => {
      if (!hasClip) return;
      await device.launchApp({ newInstance: true });
      await waitFor(element(by.id('camera-screen'))).toBeVisible().withTimeout(20000);
      await waitFor(element(by.id('gallery-thumbnail-image'))).toBeVisible().withTimeout(10000);
    });
  });
});

async function isVisible(id: string | RegExp, timeout = 3000): Promise<boolean> {
  try {
    await waitFor(element(by.id(id)).atIndex(0)).toBeVisible().withTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}
