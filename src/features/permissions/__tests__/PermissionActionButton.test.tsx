import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PermissionActionButton } from '../components/PermissionActionButton';

describe('PermissionActionButton', () => {
  it('shows the label and calls onPress when enabled', async () => {
    const onPress = jest.fn();
    const { getByText, getByTestId } = await render(
      <PermissionActionButton
        label="Permitir acesso"
        disabledLabel="Concedido"
        onPress={onPress}
        testID="permission-action-camera"
      />,
    );

    expect(getByText('Permitir acesso')).toBeTruthy();
    await fireEvent.press(getByTestId('permission-action-camera'));
    expect(onPress).toHaveBeenCalled();
  });

  it('shows the disabled label and blocks onPress when disabled', async () => {
    const onPress = jest.fn();
    const { getByText, getByTestId } = await render(
      <PermissionActionButton
        label="Permitir acesso"
        disabledLabel="Concedido"
        onPress={onPress}
        disabled
        testID="permission-action-camera"
      />,
    );

    expect(getByText('Concedido')).toBeTruthy();
    await fireEvent.press(getByTestId('permission-action-camera'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
