import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { GalleryEmptyState } from '../components/GalleryEmptyState';

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

  it('explains how to get a first clip', async () => {
    const { getByText } = await render(
      <GalleryEmptyState onBackToCamera={jest.fn()} />,
    );

    expect(getByText(/Toque no botão da câmera para começar a gravar/)).toBeTruthy();
    expect(getByText('Voltar para a câmera')).toBeTruthy();
  });

  it('dims the CTA while pressed', async () => {
    const { getByTestId } = await render(
      <GalleryEmptyState onBackToCamera={jest.fn()} />,
    );
    expect(getByTestId('gallery-empty-cta')).not.toHaveStyle({ opacity: 0.8 });

    await pressIn(getByTestId('gallery-empty-cta'));

    expect(getByTestId('gallery-empty-cta')).toHaveStyle({ opacity: 0.8 });
  });
});
