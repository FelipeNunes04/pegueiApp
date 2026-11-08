import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { GalleryButton } from '../components/GalleryButton';
import { getClipThumbnail } from '../../gallery/utils/thumbnails';
import type { SavedClip } from '../../../shared/types';

jest.mock('../../gallery/utils/thumbnails', () => ({
  getClipThumbnail: jest.fn(),
}));

const mockedGetClipThumbnail = getClipThumbnail as jest.Mock;

// Pressable only applies its `pressed` style while the responder system
// has an active touch; a plain fireEvent.press() never enters that state,
// so press-in is simulated with the same event shape RNTL's own userEvent
// dispatches for a responder grant.
function pressIn(element: Parameters<typeof fireEvent>[0]) {
  return fireEvent(element, 'responderGrant', {
    nativeEvent: {
      changedTouches: [],
      identifier: 0,
      locationX: 0,
      locationY: 0,
      pageX: 0,
      pageY: 0,
      target: 0,
      timestamp: Date.now(),
      touches: [],
    },
    persist() {},
    currentTarget: { measure() {} },
    dispatchConfig: { registrationName: 'onResponderGrant' },
  });
}
const makeClip = (): SavedClip => ({
  id: 'a',
  path: '/clips/a.mp4',
  createdAt: Date.now(),
  durationSeconds: 5,
  triggeredBy: 'manual',
});

describe('GalleryButton', () => {
  beforeEach(() => {
    mockedGetClipThumbnail.mockReset();
  });

  it('shows a placeholder when there is no last clip', async () => {
    const { getByTestId } = await render(
      <GalleryButton lastClip={null} onPress={jest.fn()} />,
    );

    expect(getByTestId('gallery-thumbnail-placeholder')).toBeTruthy();
    expect(mockedGetClipThumbnail).not.toHaveBeenCalled();
  });

  it('renders the last clip thumbnail once resolved', async () => {
    mockedGetClipThumbnail.mockResolvedValue('file:///thumb.jpg');

    const { getByTestId } = await render(
      <GalleryButton lastClip={makeClip()} onPress={jest.fn()} />,
    );

    await waitFor(() =>
      expect(getByTestId('gallery-thumbnail-image')).toBeTruthy(),
    );
  });

  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <GalleryButton lastClip={null} onPress={onPress} />,
    );

    await fireEvent.press(getByTestId('open-gallery'));

    expect(onPress).toHaveBeenCalled();
  });

  it('falls back to the placeholder when the thumbnail cannot be generated', async () => {
    mockedGetClipThumbnail.mockResolvedValue(null);

    const { getByTestId, queryByTestId } = await render(
      <GalleryButton lastClip={makeClip()} onPress={jest.fn()} />,
    );

    await waitFor(() => expect(mockedGetClipThumbnail).toHaveBeenCalledWith('/clips/a.mp4'));
    expect(getByTestId('gallery-thumbnail-placeholder')).toBeTruthy();
    expect(queryByTestId('gallery-thumbnail-image')).toBeNull();
  });

  it('goes back to the placeholder once the last clip is gone (e.g. all clips deleted)', async () => {
    mockedGetClipThumbnail.mockResolvedValue('file:///thumb.jpg');
    const { getByTestId, rerender } = await render(
      <GalleryButton lastClip={makeClip()} onPress={jest.fn()} />,
    );
    await waitFor(() => expect(getByTestId('gallery-thumbnail-image')).toBeTruthy());

    await rerender(<GalleryButton lastClip={null} onPress={jest.fn()} />);

    expect(getByTestId('gallery-thumbnail-placeholder')).toBeTruthy();
  });

  it('ignores a thumbnail that resolves after the button unmounted', async () => {
    let resolveThumb: (uri: string) => void = () => undefined;
    mockedGetClipThumbnail.mockReturnValue(
      new Promise<string>(resolve => {
        resolveThumb = resolve;
      }),
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = await render(
      <GalleryButton lastClip={makeClip()} onPress={jest.fn()} />,
    );

    await unmount();
    await act(async () => {
      resolveThumb('file:///late.jpg');
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('is labelled for screen readers and dims while pressed', async () => {
    const { getByTestId, getByLabelText } = await render(
      <GalleryButton lastClip={null} onPress={jest.fn()} />,
    );
    expect(getByLabelText('Abrir galeria')).toBeTruthy();
    expect(getByTestId('open-gallery')).not.toHaveStyle({ opacity: 0.75 });

    await pressIn(getByTestId('open-gallery'));

    expect(getByTestId('open-gallery')).toHaveStyle({ opacity: 0.75 });
  });
});
