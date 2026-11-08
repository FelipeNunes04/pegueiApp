import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RecordButton } from '../components/RecordButton';

describe('RecordButton', () => {
  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <RecordButton phase="idle" onPress={onPress} />,
    );

    await fireEvent.press(getByTestId('record-button'));

    expect(onPress).toHaveBeenCalled();
  });

  it('is disabled while saving', async () => {
    const { getByTestId } = await render(
      <RecordButton phase="saving" onPress={jest.fn()} />,
    );

    expect(getByTestId('record-button').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('shows a live elapsed-time readout while recording, but not otherwise', async () => {
    const { getByText, queryByText, rerender } = await render(
      <RecordButton phase="idle" onPress={jest.fn()} />,
    );
    expect(queryByText('0:00')).toBeNull();

    await rerender(<RecordButton phase="recording" onPress={jest.fn()} />);
    expect(getByText('0:00')).toBeTruthy();
  });

  it('respects an explicit disabled prop while idle', async () => {
    const { getByTestId } = await render(
      <RecordButton phase="idle" onPress={jest.fn()} disabled />,
    );

    expect(getByTestId('record-button').props.accessibilityState.disabled).toBe(
      true,
    );
  });
});

describe('RecordButton while paused (pocket mode)', () => {
  const { act } = require('@testing-library/react-native');
  const { Animated } = require('react-native');

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('stops the pulse loop and the elapsed-time ticking, then resumes with the real elapsed time', async () => {
    const loopSpy = jest.spyOn(Animated, 'loop');
    const { getByText, rerender } = await render(
      <RecordButton phase="recording" onPress={jest.fn()} />,
    );
    expect(loopSpy).toHaveBeenCalledTimes(1);

    loopSpy.mockClear();
    await rerender(<RecordButton phase="recording" onPress={jest.fn()} paused />);
    expect(loopSpy).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(65_000);
    });
    // Frozen while paused -- nothing re-renders behind the black overlay.
    expect(getByText('0:00')).toBeTruthy();

    await rerender(<RecordButton phase="recording" onPress={jest.fn()} />);
    expect(getByText('1:05')).toBeTruthy();
    expect(loopSpy).toHaveBeenCalledTimes(1);
  });

  it('briefly flashes a "Clipe salvo" confirmation after saving finishes', async () => {
    const { getByTestId, rerender } = await render(
      <RecordButton phase="saving" onPress={jest.fn()} />,
    );
    await rerender(<RecordButton phase="buffering" onPress={jest.fn()} />);
    expect(getByTestId('record-button').props.accessibilityLabel).toBe('Clipe salvo');

    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    expect(getByTestId('record-button').props.accessibilityLabel).toBe('Iniciar gravação');
  });
});
