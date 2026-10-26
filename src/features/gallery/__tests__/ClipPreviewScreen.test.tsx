import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import analytics from '@react-native-firebase/analytics';
import { ClipPreviewScreen } from '../ClipPreviewScreen';
import { useRecordingStore } from '../../../shared/store/recordingStore';
import type { SavedClip } from '../../../shared/types';

// Same shape as the global react-native-video mock in jest.setup.js, but
// with a stable `seek` the tests can assert on and a testID so the player's
// props (paused, source) and callbacks (onLoad/onProgress/onEnd) are
// reachable.
const mockSeek = jest.fn();
jest.mock('react-native-video', () => {
  const mockReact = require('react');
  const MockVideo = mockReact.forwardRef((props: object, ref: unknown) => {
    mockReact.useImperativeHandle(ref, () => ({ seek: mockSeek }));
    return mockReact.createElement('Video', { ...props, testID: 'video-player' });
  });
  return { __esModule: true, default: MockVideo };
});

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

  const renderPreview = (clipId = 'clip_1') =>
    render(
      <ClipPreviewScreen navigation={fakeNavigation} route={{ params: { clipId } } as never} />,
    );

  it('plays the clip from its file:// URI and starts playing immediately', async () => {
    const { getByTestId } = await renderPreview();

    expect(getByTestId('video-player').props.source).toEqual({
      uri: 'file:///clips/clip_1_d12000.mp4',
    });
    expect(getByTestId('video-player').props.paused).toBe(false);
  });

  it('does not double-prefix a clip path that is already a file:// URI', async () => {
    useRecordingStore.setState({
      clips: [{ ...clip, path: 'file:///clips/clip_1_d12000.mp4' }],
    });
    mockedShare.open.mockResolvedValue({} as never);
    const { getByTestId } = await renderPreview();

    expect(getByTestId('video-player').props.source).toEqual({
      uri: 'file:///clips/clip_1_d12000.mp4',
    });
    await fireEvent.press(getByTestId('preview-share'));
    expect(mockedShare.open).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'file:///clips/clip_1_d12000.mp4' }),
    );
  });

  it('the play/pause button and tapping the video both toggle playback', async () => {
    const { getByTestId, getAllByRole } = await renderPreview();

    await fireEvent.press(getByTestId('preview-play-pause'));
    expect(getByTestId('video-player').props.paused).toBe(true);

    // The full-screen video surface is the first button on screen.
    await fireEvent.press(getAllByRole('button')[0]);
    expect(getByTestId('video-player').props.paused).toBe(false);
  });

  it('shows the loaded duration and the playback position as it progresses', async () => {
    const { getByTestId, getByText, getAllByText } = await renderPreview();
    expect(getAllByText('0:00')).toHaveLength(2);

    await act(async () => {
      getByTestId('video-player').props.onLoad({ duration: 75 });
    });
    expect(getByText('1:15')).toBeTruthy();
    expect(getByTestId('preview-seek-slider').props.maximumValue).toBe(75);

    await act(async () => {
      getByTestId('video-player').props.onProgress({ currentTime: 12 });
    });
    expect(getByText('0:12')).toBeTruthy();
    expect(getByTestId('preview-seek-slider').props.value).toBe(12);
  });

  it('keeps a non-zero slider range before the video has loaded', async () => {
    const { getByTestId } = await renderPreview();

    expect(getByTestId('preview-seek-slider').props.maximumValue).toBeGreaterThan(0);
  });

  it('pauses at the end of the clip so it can be replayed', async () => {
    const { getByTestId } = await renderPreview();

    await act(async () => {
      getByTestId('video-player').props.onEnd();
    });

    expect(getByTestId('video-player').props.paused).toBe(true);
  });

  it('dragging the seek bar freezes progress updates and seeks the player on release', async () => {
    const { getByTestId, getByText, queryByText } = await renderPreview();
    await act(async () => {
      getByTestId('video-player').props.onLoad({ duration: 60 });
    });

    // The slider's JS onSlidingStart/onSlidingComplete props are bridged
    // to these native event names on the host component.
    await fireEvent(getByTestId('preview-seek-slider'), 'RNCSliderSlidingStart', {
      nativeEvent: { value: 0 },
    });
    // Progress events while the user is dragging must not yank the thumb back.
    await act(async () => {
      getByTestId('video-player').props.onProgress({ currentTime: 5 });
    });
    expect(queryByText('0:05')).toBeNull();

    await fireEvent(getByTestId('preview-seek-slider'), 'RNCSliderSlidingComplete', {
      nativeEvent: { value: 42 },
    });
    expect(mockSeek).toHaveBeenCalledWith(42);
    expect(getByText('0:42')).toBeTruthy();

    // After release, progress updates resume.
    await act(async () => {
      getByTestId('video-player').props.onProgress({ currentTime: 43 });
    });
    expect(getByText('0:43')).toBeTruthy();
  });

  it('the back button returns to the gallery', async () => {
    const { getByTestId } = await renderPreview();

    await fireEvent.press(getByTestId('preview-back'));

    expect(goBackMock).toHaveBeenCalledTimes(1);
  });

  it('dismissing the share sheet without sharing is not logged and does not crash', async () => {
    mockedShare.open.mockRejectedValue(new Error('User did not share'));
    const { getByTestId } = await renderPreview();

    await fireEvent.press(getByTestId('preview-share'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedShare.open).toHaveBeenCalled();
    expect(mockedLogEvent).not.toHaveBeenCalledWith('clip_shared', expect.anything());
  });

  it('bails out to the gallery if the clip is deleted elsewhere while being viewed', async () => {
    const { getByTestId, queryByTestId } = await renderPreview();
    expect(getByTestId('video-player')).toBeTruthy();

    await act(async () => {
      useRecordingStore.setState({ clips: [] });
    });

    expect(queryByTestId('video-player')).toBeNull();
    expect(getByTestId('clip-preview-screen')).toBeTruthy();
    expect(goBackMock).toHaveBeenCalled();
  });
});
