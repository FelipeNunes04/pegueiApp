import Share from 'react-native-share';
import * as RC from '@react-native-firebase/remote-config';
import { track } from '../../../analytics';
import { exportClip, formatWeight, shareExported, speciesForAnalytics } from '../exportClip';
import { exportVideo } from '../native/VideoExportModule';
import { fetchAsset } from '../sponsorAssets';
import { initRemoteConfig, resetRemoteConfigForTests } from '../../../config/remoteConfig';

jest.mock('../native/VideoExportModule', () => ({
  exportVideo: jest.fn().mockResolvedValue({ path: '/mock/caches/exports/out.mp4', width: 1080, height: 1920, durationSeconds: 20 }),
  isVideoExportAvailable: () => true,
}));
jest.mock('../sponsorAssets', () => ({
  fetchAsset: jest.fn(async (url: string) => (url ? `/mock/caches/sponsor-assets/${url.length}.png` : null)),
}));

const setValues = (RC as unknown as { __setValues: (v: Record<string, unknown>) => void }).__setValues;
const mockedExport = exportVideo as jest.Mock;
const mockedTrack = track as jest.Mock;
const mockedFetchAsset = fetchAsset as jest.Mock;

describe('formatWeight', () => {
  it.each([
    ['2.4', '2,4 kg'],
    ['2,40', '2,4 kg'],
    ['12 kg', '12 kg'],
    ['0,355', '0,36 kg'],
    ['', ''],
    ['abc', ''],
    ['0', ''],
    ['999', ''],
  ])('%s -> %s', (input, expected) => {
    expect(formatWeight(input)).toBe(expected);
  });
});

describe('exportClip', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetRemoteConfigForTests();
    setValues({});
    await initRemoteConfig();
  });

  it('exports without watermark or caption by default', async () => {
    await exportClip({ clipPath: 'file:///clips/a.mp4', portrait9x16: true, species: '', weight: '' });

    expect(mockedExport).toHaveBeenCalledWith(
      expect.objectContaining({ inputPath: '/clips/a.mp4', portrait9x16: true, watermark: null, caption: null }),
    );
    expect(mockedTrack).toHaveBeenCalledWith('video_exported', { marca_dagua: false, overlay: false, sponsor_id: '' });
    expect(mockedTrack).not.toHaveBeenCalledWith('overlay_added', expect.anything());
  });

  it('adds the sponsor watermark and caption from Remote Config', async () => {
    setValues({
      watermark_enabled: true,
      watermark_asset_url: 'https://cdn.example.com/w.png',
      sponsor_id: 'loja_picos',
      sponsor_position: 'top_right',
      overlay_sponsor_logo_url: 'https://cdn.example.com/logo.png',
    });

    await exportClip({ clipPath: '/clips/a.mp4', portrait9x16: false, species: ' Tucunaré ', weight: '2,4' });

    const options = mockedExport.mock.calls[0][0];
    expect(options.watermark).toEqual({ imagePath: expect.any(String), position: 'top_right', sponsorId: 'loja_picos' });
    expect(options.caption).toEqual({ species: 'Tucunaré', weight: '2,4 kg', logoPath: expect.any(String) });
    expect(mockedTrack).toHaveBeenCalledWith('video_exported', { marca_dagua: true, overlay: true, sponsor_id: 'loja_picos' });
    expect(mockedTrack).toHaveBeenCalledWith('overlay_added', { especie: 'tucunaré', tem_peso: true });
  });

  it('goes out without the watermark when the image cannot be fetched (offline)', async () => {
    setValues({ watermark_enabled: true, watermark_asset_url: 'https://cdn.example.com/w.png', sponsor_id: 'x' });
    mockedFetchAsset.mockResolvedValueOnce(null);

    await exportClip({ clipPath: '/clips/a.mp4', portrait9x16: true, species: '', weight: '' });

    expect(mockedExport.mock.calls[0][0].watermark).toBeNull();
    expect(mockedTrack).toHaveBeenCalledWith('video_exported', { marca_dagua: false, overlay: false, sponsor_id: '' });
  });

  it('propagates a native failure without logging an export', async () => {
    mockedExport.mockRejectedValueOnce(new Error('E_EXPORT_FAILED'));
    await expect(exportClip({ clipPath: '/clips/a.mp4', portrait9x16: true, species: '', weight: '' })).rejects.toThrow();
    expect(mockedTrack).not.toHaveBeenCalled();
  });

  it('logs the share destination of the exported file', async () => {
    (Share.open as jest.Mock).mockResolvedValueOnce({ success: true, message: 'com.burbn.instagram.shareextension' });
    await shareExported('/mock/caches/exports/out.mp4');
    expect(Share.open).toHaveBeenCalledWith({ url: 'file:///mock/caches/exports/out.mp4', type: 'video/mp4', failOnCancel: false });
    expect(mockedTrack).toHaveBeenCalledWith('video_shared', { destino: 'instagram', quantidade: 1 });
  });

  it('normalises species for analytics', () => {
    expect(speciesForAnalytics('  Tucunaré   Azul ')).toBe('tucunaré azul');
  });
});
