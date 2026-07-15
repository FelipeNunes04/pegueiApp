import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { GalleryEmptyState } from '../components/GalleryEmptyState';

describe('GalleryEmptyState', () => {
  it('renders the empty-state copy', async () => {
    const { getByText } = await render(
      <GalleryEmptyState onBackToCamera={jest.fn()} />,
    );

    expect(getByText('Nenhum clipe salvo ainda')).toBeTruthy();
  });

  it('calls onBackToCamera when the CTA is tapped', async () => {
    const onBackToCamera = jest.fn();
    const { getByTestId } = await render(
      <GalleryEmptyState onBackToCamera={onBackToCamera} />,
    );

    await fireEvent.press(getByTestId('gallery-empty-cta'));

    expect(onBackToCamera).toHaveBeenCalled();
  });
});
