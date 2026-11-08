import React from 'react';
import { Dimensions } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import analytics from '@react-native-firebase/analytics';
import { GalleryScreen } from '../GalleryScreen';
import { useRecordingStore } from '../../../shared/store/recordingStore';
import { CLIPS_DIR } from '../../../shared/utils/files';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockedShare = Share as jest.Mocked<typeof Share>;
const mockedLogEvent = analytics().logEvent as jest.Mock;

const navigateMock = jest.fn();
const goBackMock = jest.fn();
const setOptionsMock = jest.fn();
const fakeNavigation = { navigate: navigateMock, goBack: goBackMock, setOptions: setOptionsMock } as never;

function clipEntry(name: string, mtime: Date) {
  return {
    name,
    path: `${CLIPS_DIR}/${name}`,
    isFile: () => true,
    isDirectory: () => false,
    mtime,
  };
}

describe('GalleryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRecordingStore.setState({ phase: 'idle', errorMessage: null, clips: [] });
    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.readDir.mockResolvedValue([] as never);
  });

  it('shows the friendly empty state when there are no saved clips', async () => {
    const { getByTestId } = await render(<GalleryScreen navigation={fakeNavigation} route={{} as never} />);

    await waitFor(() => expect(getByTestId('gallery-empty')).toBeTruthy());
  });

  it('renders a grid grouped by date with duration and origin badges', async () => {
    const today = new Date();
    mockedRNFS.readDir.mockResolvedValue([clipEntry('clip_1000_d12000.mp4', today)] as never);

    const { getByTestId, getByText, queryByTestId } = await render(
      <GalleryScreen navigation={fakeNavigation} route={{} as never} />,
    );

    await waitFor(() => expect(queryByTestId('gallery-empty')).toBeNull());
    expect(getByText('Hoje')).toBeTruthy();
    expect(getByTestId('clip-clip_1000_d12000.mp4')).toBeTruthy();
    expect(getByTestId('clip-clip_1000_d12000.mp4-origin-manual')).toBeTruthy();
  });

  it('tapping a clip outside selection mode navigates to its preview', async () => {
    mockedRNFS.readDir.mockResolvedValue([clipEntry('clip_1000_d12000.mp4', new Date())] as never);

    const { getByTestId } = await render(<GalleryScreen navigation={fakeNavigation} route={{} as never} />);
    await waitFor(() => expect(getByTestId('clip-clip_1000_d12000.mp4')).toBeTruthy());

    await fireEvent.press(getByTestId('clip-clip_1000_d12000.mp4'));

    expect(navigateMock).toHaveBeenCalledWith('ClipPreview', { clipId: 'clip_1000_d12000.mp4' });
  });

  it('long-pressing a clip enters selection mode and shows the selection toolbar', async () => {
    mockedRNFS.readDir.mockResolvedValue([clipEntry('clip_1000_d12000.mp4', new Date())] as never);

    const { getByTestId } = await render(<GalleryScreen navigation={fakeNavigation} route={{} as never} />);
    await waitFor(() => expect(getByTestId('clip-clip_1000_d12000.mp4')).toBeTruthy());

    await fireEvent(getByTestId('clip-clip_1000_d12000.mp4'), 'longPress');

    expect(getByTestId('selection-toolbar')).toBeTruthy();
    expect(getByTestId('clip-clip_1000_d12000.mp4-checkbox')).toBeTruthy();
  });

  it('cancelling the delete confirmation does not remove the clip', async () => {
    mockedRNFS.readDir.mockResolvedValue([clipEntry('clip_1000_d12000.mp4', new Date())] as never);

    const { getByTestId } = await render(<GalleryScreen navigation={fakeNavigation} route={{} as never} />);
    await waitFor(() => expect(getByTestId('clip-clip_1000_d12000.mp4')).toBeTruthy());

    await fireEvent(getByTestId('clip-clip_1000_d12000.mp4'), 'longPress');
    await fireEvent.press(getByTestId('selection-delete'));

    expect(getByTestId('delete-confirm-modal').props.visible).toBe(true);

    await fireEvent.press(getByTestId('delete-confirm-cancel'));

    expect(mockedRNFS.unlink).not.toHaveBeenCalled();
    expect(getByTestId('clip-clip_1000_d12000.mp4')).toBeTruthy();
  });

  it('confirming the delete removes the clip and exits selection mode', async () => {
    mockedRNFS.readDir.mockResolvedValue([clipEntry('clip_1000_d12000.mp4', new Date())] as never);

    const { getByTestId, queryByTestId } = await render(<GalleryScreen navigation={fakeNavigation} route={{} as never} />);
    await waitFor(() => expect(getByTestId('clip-clip_1000_d12000.mp4')).toBeTruthy());

    await fireEvent(getByTestId('clip-clip_1000_d12000.mp4'), 'longPress');
    await fireEvent.press(getByTestId('selection-delete'));
    await fireEvent.press(getByTestId('delete-confirm-delete'));

    expect(mockedRNFS.unlink).toHaveBeenCalledWith(`${CLIPS_DIR}/clip_1000_d12000.mp4`);
    expect(queryByTestId('clip-clip_1000_d12000.mp4')).toBeNull();
    expect(queryByTestId('selection-toolbar')).toBeNull();
    expect(mockedLogEvent).toHaveBeenCalledWith('clip_deleted', { count: 1 });
  });

  it('sharing selected clips opens the native share sheet and logs it', async () => {
    mockedRNFS.readDir.mockResolvedValue([clipEntry('clip_1000_d12000.mp4', new Date())] as never);
    mockedShare.open.mockResolvedValue({} as never);

    const { getByTestId } = await render(<GalleryScreen navigation={fakeNavigation} route={{} as never} />);
    await waitFor(() => expect(getByTestId('clip-clip_1000_d12000.mp4')).toBeTruthy());

    await fireEvent(getByTestId('clip-clip_1000_d12000.mp4'), 'longPress');
    await fireEvent.press(getByTestId('selection-share'));

    expect(mockedShare.open).toHaveBeenCalled();
    await waitFor(() => expect(mockedLogEvent).toHaveBeenCalledWith('clip_shared', { count: 1 }));
  });

  describe('selection mode', () => {
    const A = 'clip_3000_d1000.mp4';
    const B = 'clip_2000_d2000.mp4';
    const C = 'clip_1000_d3000.mp4';

    async function renderWithThreeClips() {
      const now = Date.now();
      mockedRNFS.readDir.mockResolvedValue([
        clipEntry(A, new Date(now)),
        clipEntry(B, new Date(now - 1000)),
        clipEntry(C, new Date(now - 2000)),
      ] as never);
      const utils = await render(<GalleryScreen navigation={fakeNavigation} route={{} as never} />);
      await waitFor(() => expect(utils.getByTestId(`clip-${A}`)).toBeTruthy());
      return utils;
    }

    const lastOptions = () => setOptionsMock.mock.calls[setOptionsMock.mock.calls.length - 1][0];

    it('titles the header "Galeria" with no cancel button outside selection mode', async () => {
      await renderWithThreeClips();

      expect(lastOptions()).toEqual({ title: 'Galeria', headerLeft: undefined });
    });

    it('shows the selected count in the header, singular and plural', async () => {
      const { getByTestId } = await renderWithThreeClips();

      await fireEvent(getByTestId(`clip-${A}`), 'longPress');
      expect(lastOptions().title).toBe('1 selecionado');
      expect(typeof lastOptions().headerLeft).toBe('function');

      await fireEvent.press(getByTestId(`clip-${B}`));
      expect(lastOptions().title).toBe('2 selecionados');
    });

    it('tapping clips in selection mode toggles them instead of opening the preview', async () => {
      const { getByTestId, queryByTestId } = await renderWithThreeClips();

      await fireEvent(getByTestId(`clip-${A}`), 'longPress');
      await fireEvent.press(getByTestId(`clip-${B}`));
      expect(getByTestId(`clip-${B}`).props.accessibilityLabel).toBe('Selecionado');

      await fireEvent.press(getByTestId(`clip-${B}`));
      expect(getByTestId(`clip-${B}`).props.accessibilityLabel).toBe('Não selecionado');
      expect(navigateMock).not.toHaveBeenCalled();

      // Deselecting the last selected clip leaves selection mode.
      await fireEvent.press(getByTestId(`clip-${A}`));
      expect(queryByTestId('selection-toolbar')).toBeNull();
      expect(lastOptions().title).toBe('Galeria');
    });

    it('long-pressing an already-selected clip keeps it selected', async () => {
      const { getByTestId } = await renderWithThreeClips();

      await fireEvent(getByTestId(`clip-${A}`), 'longPress');
      await fireEvent(getByTestId(`clip-${A}`), 'longPress');

      expect(lastOptions().title).toBe('1 selecionado');
    });

    it('the header "Cancelar" button exits selection mode', async () => {
      const screen = await renderWithThreeClips();
      await fireEvent(screen.getByTestId(`clip-${A}`), 'longPress');
      await fireEvent.press(screen.getByTestId(`clip-${B}`));

      // react-navigation renders headerLeft itself; render it the same way.
      const HeaderLeft = lastOptions().headerLeft as () => React.ReactElement;
      const header = await render(<HeaderLeft />);
      expect(header.getByText('Cancelar')).toBeTruthy();
      await fireEvent.press(header.getByTestId('selection-cancel'));

      expect(screen.queryByTestId('selection-toolbar')).toBeNull();
      expect(screen.queryByTestId(`clip-${A}-checkbox`)).toBeNull();
      expect(lastOptions()).toEqual({ title: 'Galeria', headerLeft: undefined });
    });

    it('sharing several clips passes every file URL in one share sheet and logs the count', async () => {
      mockedShare.open.mockResolvedValue({} as never);
      const { getByTestId } = await renderWithThreeClips();

      await fireEvent(getByTestId(`clip-${A}`), 'longPress');
      await fireEvent.press(getByTestId(`clip-${C}`));
      await fireEvent.press(getByTestId('selection-share'));

      expect(mockedShare.open).toHaveBeenCalledWith({
        urls: [`file://${CLIPS_DIR}/${A}`, `file://${CLIPS_DIR}/${C}`],
      });
      await waitFor(() => expect(mockedLogEvent).toHaveBeenCalledWith('clip_shared', { count: 2 }));
    });

    it('sharing a single clip uses a single file:// URL with the video MIME type', async () => {
      mockedShare.open.mockResolvedValue({} as never);
      const { getByTestId } = await renderWithThreeClips();

      await fireEvent(getByTestId(`clip-${B}`), 'longPress');
      await fireEvent.press(getByTestId('selection-share'));

      expect(mockedShare.open).toHaveBeenCalledWith({
        url: `file://${CLIPS_DIR}/${B}`,
        type: 'video/mp4',
      });
    });

    it('dismissing the share sheet is not logged as a share and keeps the selection', async () => {
      mockedShare.open.mockRejectedValue(new Error('User did not share'));
      const { getByTestId } = await renderWithThreeClips();

      await fireEvent(getByTestId(`clip-${A}`), 'longPress');
      await fireEvent.press(getByTestId('selection-share'));
      await act(async () => {
        await Promise.resolve();
      });

      expect(mockedLogEvent).not.toHaveBeenCalledWith('clip_shared', expect.anything());
      expect(getByTestId('selection-toolbar')).toBeTruthy();
    });

    it('deleting several clips confirms with the plural count and removes only the selected ones', async () => {
      const { getByTestId, getByText, queryByTestId } = await renderWithThreeClips();

      await fireEvent(getByTestId(`clip-${A}`), 'longPress');
      await fireEvent.press(getByTestId(`clip-${C}`));
      await fireEvent.press(getByTestId('selection-delete'));
      expect(getByText('Excluir 2 vídeos?')).toBeTruthy();

      await fireEvent.press(getByTestId('delete-confirm-delete'));

      expect(mockedRNFS.unlink).toHaveBeenCalledTimes(2);
      expect(mockedRNFS.unlink).toHaveBeenCalledWith(`${CLIPS_DIR}/${A}`);
      expect(mockedRNFS.unlink).toHaveBeenCalledWith(`${CLIPS_DIR}/${C}`);
      expect(queryByTestId(`clip-${A}`)).toBeNull();
      expect(queryByTestId(`clip-${C}`)).toBeNull();
      expect(getByTestId(`clip-${B}`)).toBeTruthy();
      expect(mockedLogEvent).toHaveBeenCalledWith('clip_deleted', { count: 2 });
    });

    it('cancelling the delete keeps selection mode active', async () => {
      const { getByTestId, queryByTestId } = await renderWithThreeClips();

      await fireEvent(getByTestId(`clip-${A}`), 'longPress');
      await fireEvent.press(getByTestId('selection-delete'));
      await fireEvent.press(getByTestId('delete-confirm-cancel'));

      expect(queryByTestId('delete-confirm-modal')).toBeNull();
      expect(getByTestId('selection-toolbar')).toBeTruthy();
    });

    it('deleting every clip falls back to the empty state', async () => {
      const today = new Date();
      mockedRNFS.readDir.mockResolvedValue([clipEntry(A, today)] as never);
      const { getByTestId } = await render(<GalleryScreen navigation={fakeNavigation} route={{} as never} />);
      await waitFor(() => expect(getByTestId(`clip-${A}`)).toBeTruthy());

      await fireEvent(getByTestId(`clip-${A}`), 'longPress');
      await fireEvent.press(getByTestId('selection-delete'));
      await fireEvent.press(getByTestId('delete-confirm-delete'));

      expect(getByTestId('gallery-empty')).toBeTruthy();
    });
  });

  it('does not double-prefix clip paths that are already file:// URIs when sharing', async () => {
    mockedShare.open.mockResolvedValue({} as never);
    mockedRNFS.readDir.mockResolvedValue([
      { ...clipEntry('clip_1000_d12000.mp4', new Date()), path: 'file:///clips/clip_1000_d12000.mp4' },
    ] as never);
    const { getByTestId } = await render(<GalleryScreen navigation={fakeNavigation} route={{} as never} />);
    await waitFor(() => expect(getByTestId('clip-clip_1000_d12000.mp4')).toBeTruthy());

    await fireEvent(getByTestId('clip-clip_1000_d12000.mp4'), 'longPress');
    await fireEvent.press(getByTestId('selection-share'));

    expect(mockedShare.open).toHaveBeenCalledWith({
      url: 'file:///clips/clip_1000_d12000.mp4',
      type: 'video/mp4',
    });
  });

  it('the empty state CTA navigates back to the camera', async () => {
    const { getByTestId } = await render(<GalleryScreen navigation={fakeNavigation} route={{} as never} />);
    await waitFor(() => expect(getByTestId('gallery-empty')).toBeTruthy());

    await fireEvent.press(getByTestId('gallery-empty-cta'));

    expect(navigateMock).toHaveBeenCalledWith('Camera');
  });

  it('pull-to-refresh re-reads the clips directory and picks up new clips', async () => {
    mockedRNFS.readDir.mockResolvedValue([clipEntry('clip_1000_d12000.mp4', new Date())] as never);
    const { getByTestId } = await render(<GalleryScreen navigation={fakeNavigation} route={{} as never} />);
    await waitFor(() => expect(getByTestId('clip-clip_1000_d12000.mp4')).toBeTruthy());

    mockedRNFS.readDir.mockResolvedValue([
      clipEntry('clip_2000_d5000.mp4', new Date()),
      clipEntry('clip_1000_d12000.mp4', new Date(Date.now() - 1000)),
    ] as never);
    // fireEvent bubbles up from the cell to the list's onRefresh handler.
    await fireEvent(getByTestId('clip-clip_1000_d12000.mp4'), 'refresh');

    await waitFor(() => expect(getByTestId('clip-clip_2000_d5000.mp4')).toBeTruthy());
    expect(mockedRNFS.readDir).toHaveBeenCalledTimes(2);
  });

  // Regression: refresh() used to have no catch, so an unreadable clips
  // directory escaped as an unhandled promise rejection.
  it('shows the empty state (not an endless spinner) when the clips directory cannot be read', async () => {
    mockedRNFS.readDir.mockRejectedValue(new Error('EACCES'));

    const { getByTestId } = await render(<GalleryScreen navigation={fakeNavigation} route={{} as never} />);

    await waitFor(() => expect(getByTestId('gallery-empty')).toBeTruthy());
  });

  it('lays the grid out in 3 columns on wide (tablet) screens and 2 on phones', async () => {
    const original = Dimensions.get('window');
    mockedRNFS.readDir.mockResolvedValue([clipEntry('clip_1000_d12000.mp4', new Date())] as never);

    try {
      await act(async () => {
        Dimensions.set({ window: { ...original, width: 900 } });
      });
      const wide = await render(<GalleryScreen navigation={fakeNavigation} route={{} as never} />);
      await waitFor(() => expect(wide.getByTestId('clip-clip_1000_d12000.mp4')).toBeTruthy());
      expect(wide.getByTestId('clip-clip_1000_d12000.mp4')).toHaveStyle({ width: 298 });
      await wide.unmount();

      await act(async () => {
        Dimensions.set({ window: { ...original, width: 400 } });
      });
      const phone = await render(<GalleryScreen navigation={fakeNavigation} route={{} as never} />);
      await waitFor(() => expect(phone.getByTestId('clip-clip_1000_d12000.mp4')).toBeTruthy());
      expect(phone.getByTestId('clip-clip_1000_d12000.mp4')).toHaveStyle({ width: 198 });
    } finally {
      await act(async () => {
        Dimensions.set({ window: original });
      });
    }
  });
});
