import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ScrimIconButton } from '../components/ScrimIconButton';

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
describe('ScrimIconButton', () => {
  it('renders its children and calls onPress when tapped', async () => {
    const onPress = jest.fn();
    const { getByTestId, getByText } = await render(
      <ScrimIconButton
        onPress={onPress}
        accessibilityLabel="Abrir configurações"
        testID="open-settings"
      >
        <Text>icon</Text>
      </ScrimIconButton>,
    );

    expect(getByText('icon')).toBeTruthy();
    await fireEvent.press(getByTestId('open-settings'));
    expect(onPress).toHaveBeenCalled();
  });

  it('exposes the given accessibility label', async () => {
    const { getByLabelText } = await render(
      <ScrimIconButton
        onPress={jest.fn()}
        accessibilityLabel="Voltar"
        testID="back"
      >
        <Text>icon</Text>
      </ScrimIconButton>,
    );

    expect(getByLabelText('Voltar')).toBeTruthy();
  });

  it('is announced as a button to screen readers', async () => {
    const { getByRole } = await render(
      <ScrimIconButton onPress={jest.fn()} accessibilityLabel="Compartilhar">
        <Text>icon</Text>
      </ScrimIconButton>,
    );

    expect(getByRole('button', { name: 'Compartilhar' })).toBeTruthy();
  });

  it('renders a 40pt circle by default and honours a custom size', async () => {
    const { getByTestId, rerender } = await render(
      <ScrimIconButton onPress={jest.fn()} accessibilityLabel="x" testID="btn">
        <Text>icon</Text>
      </ScrimIconButton>,
    );
    expect(getByTestId('btn')).toHaveStyle({ width: 40, height: 40, borderRadius: 20 });

    await rerender(
      <ScrimIconButton onPress={jest.fn()} accessibilityLabel="x" testID="btn" size={56}>
        <Text>icon</Text>
      </ScrimIconButton>,
    );
    expect(getByTestId('btn')).toHaveStyle({ width: 56, height: 56, borderRadius: 28 });
  });

  it('dims while pressed to give touch feedback', async () => {
    const { getByTestId } = await render(
      <ScrimIconButton onPress={jest.fn()} accessibilityLabel="x" testID="btn">
        <Text>icon</Text>
      </ScrimIconButton>,
    );
    expect(getByTestId('btn')).not.toHaveStyle({ opacity: 0.7 });

    await pressIn(getByTestId('btn'));

    expect(getByTestId('btn')).toHaveStyle({ opacity: 0.7 });
  });
});
