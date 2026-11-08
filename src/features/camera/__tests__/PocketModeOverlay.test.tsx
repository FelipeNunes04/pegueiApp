import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PocketModeOverlay } from '../components/PocketModeOverlay';

describe('PocketModeOverlay', () => {
  it('shows a dim status line for the current phase and exits on a single tap', async () => {
    const onExit = jest.fn();
    const { getByTestId, getByText } = await render(
      <PocketModeOverlay phase="recording" health="healthy" onExit={onExit} />,
    );

    expect(getByTestId('pocket-mode-status').props.children).toBe('Gravando');
    expect(getByText('Toque para sair')).toBeTruthy();
    expect(getByTestId('pocket-mode-overlay').props.accessibilityLabel).toBe(
      'Modo bolso ativo, Gravando. Toque para sair.',
    );

    await fireEvent.press(getByTestId('pocket-mode-overlay'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('includes the buffer health when it is not healthy', async () => {
    const { getByTestId } = await render(
      <PocketModeOverlay phase="buffering" health="throttled" onExit={jest.fn()} />,
    );

    expect(getByTestId('pocket-mode-status').props.children).toBe('Sempre gravando · Reduzido (calor)');
  });
});
