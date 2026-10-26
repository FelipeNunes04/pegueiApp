import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AutoStoppedOverlay } from '../components/AutoStoppedOverlay';

describe('AutoStoppedOverlay', () => {
  it('explains why the buffer stopped and resumes on "Retomar"', async () => {
    const onResume = jest.fn();
    const { getByTestId, getByText } = await render(
      <AutoStoppedOverlay minutes={30} onResume={onResume} />,
    );

    expect(getByText('Buffer desligado')).toBeTruthy();
    expect(getByText(/após 30 minutos sem uso/)).toBeTruthy();

    await fireEvent.press(getByTestId('resume-buffer'));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('formats whole hours', async () => {
    const { getByText, rerender } = await render(<AutoStoppedOverlay minutes={60} onResume={jest.fn()} />);
    expect(getByText(/após 1 hora sem uso/)).toBeTruthy();

    await rerender(<AutoStoppedOverlay minutes={120} onResume={jest.fn()} />);
    expect(getByText(/após 2 horas sem uso/)).toBeTruthy();
  });
});
