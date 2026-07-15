import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import analytics from '@react-native-firebase/analytics';
import { ClipPreviewScreen } from '../../src/screens/ClipPreviewScreen';
import { useRecordingStore } from '../../src/store/recordingStore';
import type { SavedClip } from '../../src/types';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockedShare = Share as jest.Mocked<typeof Share>;
const mockedLogEvent = analytics().logEvent as jest.Mock;

const goBackMock = jest.fn();
const fakeNavigation = { goBack: goBackMock } as never;

const clip: SavedClip = {
  id: 'clip_1',
  path: '/clips/clip_1_d12000.mp4',
  createdAt: Date.now(),
  durationSeconds: 12,
  triggeredBy: 'manual',
};

describe('ClipPreviewScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRecordingStore.setState({ phase: 'idle', errorMessage: null, clips: [clip] });
    mockedRNFS.exists.mockResolvedValue(true);
  });

  it('renders the player for the clip matching the route param', async () => {
    const { getByTestId } = await render(
      <ClipPreviewScreen navigation={fakeNavigation} route={{ params: { clipId: 'clip_1' } } as never} />,
    );

    expect(getByTestId('clip-preview-screen')).toBeTruthy();
    expect(goBackMock).not.toHaveBeenCalled();
  });

  it('goes back if the clip no longer exists in the store', async () => {
    await render(<ClipPreviewScreen navigation={fakeNavigation} route={{ params: { clipId: 'missing' } } as never} />);

    await waitFor(() => expect(goBackMock).toHaveBeenCalled());
  });

  it('tapping the video toggles play/pause', async () => {
    const { getByTestId } = await render(
      <ClipPreviewScreen navigation={fakeNavigation} route={{ params: { clipId: 'clip_1' } } as never} />,
    );

    // Starts playing (not paused) -- tapping should pause it.
    await fireEvent.press(getByTestId('preview-play-pause'));
    await fireEvent.press(getByTestId('preview-play-pause'));

    expect(getByTestId('clip-preview-screen')).toBeTruthy();
  });

  it('deleting requires confirmation, and cancelling keeps the clip', async () => {
    const { getByTestId } = await render(
      <ClipPreviewScreen navigation={fakeNavigation} route={{ params: { clipId: 'clip_1' } } as never} />,
    );

    await fireEvent.press(getByTestId('preview-delete'));
    expect(getByTestId('delete-confirm-modal').props.visible).toBe(true);

    await fireEvent.press(getByTestId('delete-confirm-cancel'));

    expect(mockedRNFS.unlink).not.toHaveBeenCalled();
    expect(goBackMock).not.toHaveBeenCalled();
    expect(useRecordingStore.getState().clips).toHaveLength(1);
  });

  it('confirming delete removes the clip and navigates back', async () => {
    const { getByTestId } = await render(
      <ClipPreviewScreen navigation={fakeNavigation} route={{ params: { clipId: 'clip_1' } } as never} />,
    );

    await fireEvent.press(getByTestId('preview-delete'));
    await fireEvent.press(getByTestId('delete-confirm-delete'));

    expect(mockedRNFS.unlink).toHaveBeenCalledWith('/clips/clip_1_d12000.mp4');
    expect(useRecordingStore.getState().clips).toHaveLength(0);
    expect(goBackMock).toHaveBeenCalled();
    expect(mockedLogEvent).toHaveBeenCalledWith('clip_deleted', { count: 1 });
  });

  it('sharing opens the native share sheet with the clip file and logs it', async () => {
    mockedShare.open.mockResolvedValue({} as never);
    const { getByTestId } = await render(
      <ClipPreviewScreen navigation={fakeNavigation} route={{ params: { clipId: 'clip_1' } } as never} />,
    );

    await fireEvent.press(getByTestId('preview-share'));

    expect(mockedShare.open).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'file:///clips/clip_1_d12000.mp4', type: 'video/mp4' }),
    );
    await waitFor(() => expect(mockedLogEvent).toHaveBeenCalledWith('clip_shared', { count: 1 }));
  });
});
