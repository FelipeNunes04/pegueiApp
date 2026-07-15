import { Platform } from 'react-native';
import { createThumbnail } from 'react-native-create-thumbnail';
import { clearClipThumbnailCache, getClipThumbnail } from '../utils/thumbnails';

const mockedCreateThumbnail = createThumbnail as jest.Mock;

describe('getClipThumbnail', () => {
  beforeEach(() => {
    mockedCreateThumbnail.mockReset();
  });

  it('strips a file:// prefix and re-adds it only on Android', async () => {
    Platform.OS = 'android';
    mockedCreateThumbnail.mockResolvedValue({ path: '/thumb.jpg' });

    await getClipThumbnail('file:///clips/android-clip.mp4');

    expect(mockedCreateThumbnail).toHaveBeenCalledWith({
      url: 'file:///clips/android-clip.mp4',
      timeStamp: 0,
    });
  });

  it('passes a bare path (no file:// prefix) on iOS', async () => {
    Platform.OS = 'ios';
    mockedCreateThumbnail.mockResolvedValue({ path: '/thumb.jpg' });

    await getClipThumbnail('file:///clips/ios-clip.mp4');

    expect(mockedCreateThumbnail).toHaveBeenCalledWith({
      url: '/clips/ios-clip.mp4',
      timeStamp: 0,
    });
  });

  it('memoizes by path -- a second call for the same clip does not re-invoke the native extractor', async () => {
    Platform.OS = 'ios';
    mockedCreateThumbnail.mockResolvedValue({ path: '/thumb.jpg' });

    await getClipThumbnail('/clips/cached-clip.mp4');
    await getClipThumbnail('/clips/cached-clip.mp4');

    expect(mockedCreateThumbnail).toHaveBeenCalledTimes(1);
  });

  it('returns null and does not cache on failure, so a retry is possible', async () => {
    mockedCreateThumbnail.mockRejectedValueOnce(
      new Error('no permission to view it'),
    );
    mockedCreateThumbnail.mockResolvedValueOnce({ path: '/thumb.jpg' });

    const first = await getClipThumbnail('/clips/retry-clip.mp4');
    expect(first).toBeNull();

    const second = await getClipThumbnail('/clips/retry-clip.mp4');
    expect(second).toBe('file:///thumb.jpg');
    expect(mockedCreateThumbnail).toHaveBeenCalledTimes(2);
  });

  it('clearClipThumbnailCache forces the next lookup to re-invoke the native extractor', async () => {
    mockedCreateThumbnail.mockResolvedValue({ path: '/thumb.jpg' });

    await getClipThumbnail('/clips/evict-clip.mp4');
    clearClipThumbnailCache('/clips/evict-clip.mp4');
    await getClipThumbnail('/clips/evict-clip.mp4');

    expect(mockedCreateThumbnail).toHaveBeenCalledTimes(2);
  });
});
