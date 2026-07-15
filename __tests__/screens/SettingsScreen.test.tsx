import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { SettingsScreen } from '../../src/screens/SettingsScreen';

const navigateMock = jest.fn();
const fakeNavigation = { navigate: navigateMock } as never;

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('copies the Pix key to the clipboard when the donation box is pressed', async () => {
    const { getByTestId, getByText } = await render(<SettingsScreen navigation={fakeNavigation} route={{} as never} />);

    await fireEvent.press(getByTestId('settings-copy-pix'));

    expect(Clipboard.setString).toHaveBeenCalledWith('felipennunes04@icloud.com');
    expect(getByText('Copiado!')).toBeTruthy();
  });

  it('navigates to Tips when the "Dicas de uso" row is pressed', async () => {
    const { getByTestId } = await render(<SettingsScreen navigation={fakeNavigation} route={{} as never} />);

    await fireEvent.press(getByTestId('settings-open-tips'));

    expect(navigateMock).toHaveBeenCalledWith('Tips');
  });
});
