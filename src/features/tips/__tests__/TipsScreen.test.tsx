import React from 'react';
import { render } from '@testing-library/react-native';
import { TipsScreen } from '../TipsScreen';

describe('TipsScreen', () => {
  it('renders every tip card', async () => {
    const { getByTestId } = await render(<TipsScreen />);

    expect(getByTestId('tip-app')).toBeTruthy();
    expect(getByTestId('tip-battery')).toBeTruthy();
    expect(getByTestId('tip-storage')).toBeTruthy();
  });
});
