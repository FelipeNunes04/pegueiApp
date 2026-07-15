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
