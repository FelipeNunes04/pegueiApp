import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SelectionToolbar } from '../components/SelectionToolbar';

describe('SelectionToolbar', () => {
  it('calls onShare and onDelete when their buttons are tapped', async () => {
    const onShare = jest.fn();
    const onDelete = jest.fn();
    const { getByTestId } = await render(
      <SelectionToolbar count={2} onShare={onShare} onDelete={onDelete} />,
    );

    await fireEvent.press(getByTestId('selection-share'));
    await fireEvent.press(getByTestId('selection-delete'));

    expect(onShare).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
  });

  it('disables both actions when nothing is selected', async () => {
    const { getByTestId } = await render(
      <SelectionToolbar count={0} onShare={jest.fn()} onDelete={jest.fn()} />,
    );

    expect(
      getByTestId('selection-share').props.accessibilityState.disabled,
    ).toBe(true);
    expect(
      getByTestId('selection-delete').props.accessibilityState.disabled,
    ).toBe(true);
  });
});
