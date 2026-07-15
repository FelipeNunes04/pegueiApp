import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { GalleryButton } from '../components/GalleryButton';
import { getClipThumbnail } from '../../gallery/utils/thumbnails';
import type { SavedClip } from '../../../shared/types';

jest.mock('../../gallery/utils/thumbnails', () => ({
  getClipThumbnail: jest.fn(),
}));

const mockedGetClipThumbnail = getClipThumbnail as jest.Mock;

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
});
