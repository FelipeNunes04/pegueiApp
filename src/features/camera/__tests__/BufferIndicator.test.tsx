import React from 'react';
import { render } from '@testing-library/react-native';
import { BufferIndicator } from '../components/BufferIndicator';

describe('BufferIndicator', () => {
  it('shows the buffer seconds and a phase label', async () => {
    const { getByText } = await render(
      <BufferIndicator phase="buffering" bufferSeconds={20} />,
    );

    expect(getByText('Sempre gravando')).toBeTruthy();
    expect(getByText('20s')).toBeTruthy();
  });

  it('shows a distinct label per phase', async () => {
    const { getByText, rerender } = await render(
      <BufferIndicator phase="idle" bufferSeconds={20} />,
    );
    expect(getByText('Parado')).toBeTruthy();

    await rerender(<BufferIndicator phase="recording" bufferSeconds={20} />);
    expect(getByText('Gravando')).toBeTruthy();

    await rerender(<BufferIndicator phase="error" bufferSeconds={20} />);
    expect(getByText('Erro')).toBeTruthy();
  });
});

describe('BufferIndicator health and pause', () => {
  const { Animated } = require('react-native');
  let loopSpy: jest.SpyInstance;

  beforeEach(() => {
    loopSpy = jest.spyOn(Animated, 'loop');
  });

  afterEach(() => {
    loopSpy.mockRestore();
  });

  it('shows the health state next to the buffer length, with an accessible label', async () => {
    const { getByTestId, rerender } = await render(
      <BufferIndicator phase="buffering" bufferSeconds={30} health="recovering" />,
    );
    expect(getByTestId('buffer-indicator-sublabel').props.children).toBe('30s · Recuperando…');
    expect(getByTestId('buffer-indicator').props.accessibilityLabel).toBe(
      'Sempre gravando, últimos 30 segundos. Recuperando…',
    );

    await rerender(<BufferIndicator phase="recording" bufferSeconds={30} health="interrupted" />);
    expect(getByTestId('buffer-indicator-sublabel').props.children).toBe('30s · Interrompido');

    await rerender(<BufferIndicator phase="buffering" bufferSeconds={30} health="throttled" />);
    expect(getByTestId('buffer-indicator-sublabel').props.children).toBe('30s · Reduzido (calor)');
  });

  it('hides a stale health state once the buffer is stopped', async () => {
    const { getByTestId } = await render(
      <BufferIndicator phase="idle" bufferSeconds={30} health="interrupted" />,
    );
    expect(getByTestId('buffer-indicator-sublabel').props.children).toBe('30s');
    expect(getByTestId('buffer-indicator').props.accessibilityLabel).toBe('Parado, últimos 30 segundos');
  });

  it('pulses only while buffering, healthy and not paused (pocket mode)', async () => {
    const { rerender } = await render(<BufferIndicator phase="buffering" bufferSeconds={30} />);
    expect(loopSpy).toHaveBeenCalledTimes(1);

    loopSpy.mockClear();
    await rerender(<BufferIndicator phase="buffering" bufferSeconds={30} paused />);
    await rerender(<BufferIndicator phase="buffering" bufferSeconds={30} paused health="throttled" />);
    await rerender(<BufferIndicator phase="buffering" bufferSeconds={30} health="throttled" />);
    expect(loopSpy).not.toHaveBeenCalled();
  });
});
