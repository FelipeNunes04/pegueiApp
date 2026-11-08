import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ClipGridThumbnail } from '../components/ClipGridThumbnail';
import { getClipThumbnail } from '../utils/thumbnails';
import type { SavedClip } from '../../../shared/types';

jest.mock('../utils/thumbnails', () => ({
  getClipThumbnail: jest.fn(),
}));

const mockedGetClipThumbnail = getClipThumbnail as jest.Mock;

const makeClip = (): SavedClip => ({
  id: 'clip-1',
  path: '/clips/clip-1.mp4',
  createdAt: Date.now(),
  durationSeconds: 65,
  triggeredBy: 'manual',
});

describe('ClipGridThumbnail', () => {
  beforeEach(() => {
    mockedGetClipThumbnail.mockReset().mockResolvedValue(null);
  });

  // Every render kicks off the thumbnail-loading effect's promise; waiting
  // for it here (even when a test doesn't care about the result) keeps its
  // resolution from leaking into whichever test happens to run next.
  const flushThumbnailEffect = () =>
    waitFor(() => expect(mockedGetClipThumbnail).toHaveBeenCalled());

  it('renders the formatted duration', async () => {
    const { getByText } = await render(
      <ClipGridThumbnail
        clip={makeClip()}
        size={100}
        selectionMode={false}
        selected={false}
        onPress={jest.fn()}
        onLongPress={jest.fn()}
      />,
    );

    expect(getByText('1:05')).toBeTruthy();
    await flushThumbnailEffect();
  });

  it('calls onPress with the clip when tapped', async () => {
    const onPress = jest.fn();
    const clip = makeClip();
    const { getByTestId } = await render(
      <ClipGridThumbnail
        clip={clip}
        size={100}
        selectionMode={false}
        selected={false}
        onPress={onPress}
        onLongPress={jest.fn()}
      />,
    );

    await fireEvent.press(getByTestId(`clip-${clip.id}`));

    expect(onPress).toHaveBeenCalledWith(clip);
    await flushThumbnailEffect();
  });

  it('calls onLongPress with the clip on long-press', async () => {
    const onLongPress = jest.fn();
    const clip = makeClip();
    const { getByTestId } = await render(
      <ClipGridThumbnail
        clip={clip}
        size={100}
        selectionMode={false}
        selected={false}
        onPress={jest.fn()}
        onLongPress={onLongPress}
      />,
    );

    await fireEvent(getByTestId(`clip-${clip.id}`), 'longPress');

    expect(onLongPress).toHaveBeenCalledWith(clip);
    await flushThumbnailEffect();
  });

  it('shows a selection checkbox only in selection mode', async () => {
    const clip = makeClip();
    const { getByTestId, queryByTestId, rerender } = await render(
      <ClipGridThumbnail
        clip={clip}
        size={100}
        selectionMode={false}
        selected={false}
        onPress={jest.fn()}
        onLongPress={jest.fn()}
      />,
    );

    expect(queryByTestId(`clip-${clip.id}-checkbox`)).toBeNull();
    await flushThumbnailEffect();

    await rerender(
      <ClipGridThumbnail
        clip={clip}
        size={100}
        selectionMode
        selected
        onPress={jest.fn()}
        onLongPress={jest.fn()}
      />,
    );

    expect(getByTestId(`clip-${clip.id}-checkbox`)).toBeTruthy();
  });

  it('renders the thumbnail image once resolved', async () => {
    mockedGetClipThumbnail.mockResolvedValue('file:///thumb.jpg');
    const clip = makeClip();

    const { getByTestId } = await render(
      <ClipGridThumbnail
        clip={clip}
        size={100}
        selectionMode={false}
        selected={false}
        onPress={jest.fn()}
        onLongPress={jest.fn()}
      />,
    );

    await waitFor(() =>
      expect(getByTestId(`clip-${clip.id}-image`)).toBeTruthy(),
    );
  });

  it('labels the cell for screen readers according to the selection state', async () => {
    const clip = makeClip();
    const props = { clip, size: 100, onPress: jest.fn(), onLongPress: jest.fn() };
    const { getByTestId, rerender } = await render(
      <ClipGridThumbnail {...props} selectionMode={false} selected={false} />,
    );
    await flushThumbnailEffect();
    expect(getByTestId(`clip-${clip.id}`).props.accessibilityLabel).toBe('Abrir vídeo');

    await rerender(<ClipGridThumbnail {...props} selectionMode selected={false} />);
    expect(getByTestId(`clip-${clip.id}`).props.accessibilityLabel).toBe('Não selecionado');

    await rerender(<ClipGridThumbnail {...props} selectionMode selected />);
    expect(getByTestId(`clip-${clip.id}`).props.accessibilityLabel).toBe('Selecionado');
  });

  it('keeps the placeholder when no thumbnail can be generated', async () => {
    const clip = makeClip();
    const { queryByTestId } = await render(
      <ClipGridThumbnail
        clip={clip}
        size={100}
        selectionMode={false}
        selected={false}
        onPress={jest.fn()}
        onLongPress={jest.fn()}
      />,
    );

    await flushThumbnailEffect();
    expect(queryByTestId(`clip-${clip.id}-image`)).toBeNull();
  });

  it('sizes the cell to the given grid size', async () => {
    const clip = makeClip();
    const { getByTestId } = await render(
      <ClipGridThumbnail
        clip={clip}
        size={123}
        selectionMode={false}
        selected={false}
        onPress={jest.fn()}
        onLongPress={jest.fn()}
      />,
    );

    expect(getByTestId(`clip-${clip.id}`)).toHaveStyle({ width: 123, height: 123 });
    await flushThumbnailEffect();
  });

  it('ignores a thumbnail that resolves after the cell was unmounted (scrolled away)', async () => {
    let resolveThumb: (uri: string) => void = () => undefined;
    mockedGetClipThumbnail.mockReturnValue(
      new Promise<string>(resolve => {
        resolveThumb = resolve;
      }),
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = await render(
      <ClipGridThumbnail
        clip={makeClip()}
        size={100}
        selectionMode={false}
        selected={false}
        onPress={jest.fn()}
        onLongPress={jest.fn()}
      />,
    );

    await unmount();
    await act(async () => {
      resolveThumb('file:///late.jpg');
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
