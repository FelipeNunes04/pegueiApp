import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ScrimIconButton } from '../components/ScrimIconButton';

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
});
