import RNFS from 'react-native-fs';
import { assetFileName, fetchAsset, getCachedAsset } from '../sponsorAssets';

const fs = RNFS as jest.Mocked<typeof RNFS>;

describe('sponsorAssets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.exists.mockResolvedValue(false);
    fs.stat.mockResolvedValue({ size: 1000 } as never);
  });

  it('names files by URL hash and keeps the image extension', () => {
    expect(assetFileName('https://a.b/logo.JPG?v=2')).toMatch(/^[0-9a-f]+\.jpg$/);
    expect(assetFileName('https://a.b/x')).toMatch(/\.png$/);
    expect(assetFileName('https://a.b/1.png')).not.toBe(assetFileName('https://a.b/2.png'));
  });

  it('returns the cached file without downloading again', async () => {
    fs.exists.mockResolvedValue(true);
    const path = await fetchAsset('https://a.b/w.png');
    expect(path).toContain('/mock/caches/sponsor-assets/');
    expect(fs.downloadFile).not.toHaveBeenCalled();
  });

  it('downloads into the caches folder', async () => {
    const path = await fetchAsset('https://a.b/w.png');
    expect(fs.downloadFile).toHaveBeenCalledWith(expect.objectContaining({ fromUrl: 'https://a.b/w.png' }));
    expect(fs.moveFile).toHaveBeenCalled();
    expect(path).toMatch(/\.png$/);
  });

  it('gives up on an HTTP error or an oversized file, and on no URL', async () => {
    fs.downloadFile.mockReturnValueOnce({ jobId: 1, promise: Promise.resolve({ statusCode: 404, bytesWritten: 0 }) } as never);
    expect(await fetchAsset('https://a.b/missing.png')).toBeNull();

    fs.stat.mockResolvedValueOnce({ size: 10 * 1024 * 1024 } as never);
    expect(await fetchAsset('https://a.b/huge.png')).toBeNull();

    expect(await fetchAsset('')).toBeNull();
    expect(await getCachedAsset('')).toBeNull();
  });

  it('returns null when offline', async () => {
    fs.downloadFile.mockReturnValueOnce({ jobId: 1, promise: Promise.reject(new Error('offline')) } as never);
    expect(await fetchAsset('https://a.b/w.png')).toBeNull();
  });
});
