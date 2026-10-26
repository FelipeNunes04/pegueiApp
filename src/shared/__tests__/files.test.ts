import RNFS from 'react-native-fs';
import { createThumbnail } from 'react-native-create-thumbnail';
import {
  CLIPS_DIR,
  deleteClip,
  encodeClipFilename,
  ensureClipsDirExists,
  listSavedClips,
} from '../utils/files';
import { getClipThumbnail } from '../../features/gallery/utils/thumbnails';

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

const mockedCreateThumbnail = createThumbnail as jest.Mock;

function entry(
  name: string,
  { isFile = true, mtime }: { isFile?: boolean; mtime?: Date } = {},
) {
  return {
    name,
    path: `${CLIPS_DIR}/${name}`,
    isFile: () => isFile,
    isDirectory: () => !isFile,
    mtime,
  };
}

describe('files utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.readDir.mockResolvedValue([] as never);
  });

  describe('encodeClipFilename', () => {
    it('bakes the rounded duration into the filename so the gallery can recover it later', () => {
      expect(encodeClipFilename(1700000000000, 12345.6)).toBe(
        'clip_1700000000000_d12346.mp4',
      );
    });
  });

  describe('ensureClipsDirExists', () => {
    it('creates the clips directory on first use', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      await ensureClipsDirExists();

      expect(mockedRNFS.mkdir).toHaveBeenCalledWith(CLIPS_DIR);
    });

    it('does not recreate an existing clips directory', async () => {
      await ensureClipsDirExists();

      expect(mockedRNFS.mkdir).not.toHaveBeenCalled();
    });
  });

  describe('listSavedClips', () => {
    it('creates the directory and returns an empty list on a fresh install', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      await expect(listSavedClips()).resolves.toEqual([]);
      expect(mockedRNFS.mkdir).toHaveBeenCalledWith(CLIPS_DIR);
    });

    it('decodes the duration from the filename, and falls back to 0 for legacy names without one', async () => {
      mockedRNFS.readDir.mockResolvedValue([
        entry('clip_2000_d12500.mp4', { mtime: new Date(2000) }),
        entry('clip_1000.mov', { mtime: new Date(1000) }),
      ] as never);

      const clips = await listSavedClips();

      expect(clips).toEqual([
        {
          id: 'clip_2000_d12500.mp4',
          path: `${CLIPS_DIR}/clip_2000_d12500.mp4`,
          createdAt: 2000,
          durationSeconds: 12.5,
          triggeredBy: 'manual',
        },
        {
          id: 'clip_1000.mov',
          path: `${CLIPS_DIR}/clip_1000.mov`,
          createdAt: 1000,
          durationSeconds: 0,
          triggeredBy: 'manual',
        },
      ]);
    });

    it('accepts any .mp4/.mov file (case-insensitive) even when it does not match the clip naming scheme', async () => {
      mockedRNFS.readDir.mockResolvedValue([
        entry('IMPORTED.MOV', { mtime: new Date(5) }),
      ] as never);

      const clips = await listSavedClips();

      expect(clips).toHaveLength(1);
      expect(clips[0]).toMatchObject({ id: 'IMPORTED.MOV', durationSeconds: 0 });
    });

    it('skips sub-directories even if their name looks like a video', async () => {
      mockedRNFS.readDir.mockResolvedValue([
        entry('folder.mp4', { isFile: false, mtime: new Date(1) }),
      ] as never);

      await expect(listSavedClips()).resolves.toEqual([]);
    });

    it('falls back to "now" when the filesystem reports no modification time', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(424242);
      mockedRNFS.readDir.mockResolvedValue([entry('clip_1_d1000.mp4')] as never);

      const clips = await listSavedClips();

      expect(clips[0].createdAt).toBe(424242);
      (Date.now as jest.Mock).mockRestore();
    });
  });

  describe('deleteClip', () => {
    it('evicts the cached thumbnail so a re-used path is decoded again', async () => {
      mockedCreateThumbnail.mockResolvedValue({ path: '/thumb.jpg' });
      const path = `${CLIPS_DIR}/clip_9_d1000.mp4`;

      await getClipThumbnail(path);
      await deleteClip(path);
      await getClipThumbnail(path);

      expect(mockedRNFS.unlink).toHaveBeenCalledWith(path);
      expect(mockedCreateThumbnail).toHaveBeenCalledTimes(2);
    });

    it('still evicts the cached thumbnail when the file is already gone', async () => {
      mockedCreateThumbnail.mockResolvedValue({ path: '/thumb.jpg' });
      mockedRNFS.exists.mockResolvedValue(false);
      const path = `${CLIPS_DIR}/clip_10_d1000.mp4`;

      await getClipThumbnail(path);
      await deleteClip(path);
      await getClipThumbnail(path);

      expect(mockedRNFS.unlink).not.toHaveBeenCalled();
      expect(mockedCreateThumbnail).toHaveBeenCalledTimes(2);
    });
  });
});
