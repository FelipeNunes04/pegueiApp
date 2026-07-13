import RNFS from 'react-native-fs';
import { CLIPS_DIR, deleteClip, listSavedClips } from '../../src/utils/files';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;

describe('listSavedClips', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRNFS.exists.mockResolvedValue(true);
  });

  it('lists clips and filters to video files only', async () => {
    mockedRNFS.readDir.mockResolvedValue([
      {
        name: 'clip_1.mp4',
        path: `${CLIPS_DIR}/clip_1.mp4`,
        isFile: () => true,
        isDirectory: () => false,
        mtime: new Date(2000),
      },
      {
        name: 'clip_2.mp4',
        path: `${CLIPS_DIR}/clip_2.mp4`,
        isFile: () => true,
        isDirectory: () => false,
        mtime: new Date(1000),
      },
      {
        name: 'not-a-clip.txt',
        path: `${CLIPS_DIR}/not-a-clip.txt`,
        isFile: () => true,
        isDirectory: () => false,
        mtime: new Date(3000),
      },
    ] as never);

    const clips = await listSavedClips();

    expect(clips).toHaveLength(2);
    // Sorted newest first.
    expect(clips[0].id).toBe('clip_1.mp4');
  });
});

describe('deleteClip', () => {
  it('unlinks the file when it exists', async () => {
    mockedRNFS.exists.mockResolvedValue(true);
    await deleteClip('/some/path.mp4');
    expect(mockedRNFS.unlink).toHaveBeenCalledWith('/some/path.mp4');
  });

  it('does nothing when the file does not exist', async () => {
    jest.clearAllMocks();
    mockedRNFS.exists.mockResolvedValue(false);
    await deleteClip('/missing/path.mp4');
    expect(mockedRNFS.unlink).not.toHaveBeenCalled();
  });
});
