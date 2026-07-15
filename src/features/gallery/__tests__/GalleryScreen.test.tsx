import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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
});
