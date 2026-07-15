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
