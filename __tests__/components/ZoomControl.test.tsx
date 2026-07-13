import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ZoomControl } from '../../src/components/ZoomControl';

describe('ZoomControl', () => {
  it('renders a pill per level and highlights the one nearest the current zoom factor', async () => {
    const { getByTestId } = await render(<ZoomControl levels={[0.5, 1, 2]} zoomFactor={1.3} onSelect={jest.fn()} />);

    expect(getByTestId('zoom-pill-0.5').props.accessibilityState.selected).toBe(false);
    expect(getByTestId('zoom-pill-1').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('zoom-pill-2').props.accessibilityState.selected).toBe(false);
  });

  it('tapping a pill calls onSelect with that level', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(<ZoomControl levels={[0.5, 1, 2]} zoomFactor={1} onSelect={onSelect} />);

    fireEvent.press(getByTestId('zoom-pill-2'));

    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('renders nothing when fewer than two levels are available (single-lens device)', async () => {
    const { queryByTestId } = await render(<ZoomControl levels={[1]} zoomFactor={1} onSelect={jest.fn()} />);

    expect(queryByTestId('zoom-control')).toBeNull();
  });
});
