import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OnboardingProfileScreen } from '../OnboardingProfileScreen';
import { useProfileStore } from '../store/profileStore';
import { setUserProperties, track } from '../../../analytics';

const mockedTrack = track as jest.Mock;
const mockedSetUserProperties = setUserProperties as jest.Mock;
const replaceMock = jest.fn();
const fakeNavigation = { replace: replaceMock } as never;

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function renderScreen() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <OnboardingProfileScreen navigation={fakeNavigation} route={{} as never} />
    </SafeAreaProvider>,
  );
}

describe('OnboardingProfileScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    useProfileStore.setState({ tipoPesca: 'nao_informado', estado: 'nao_informado' });
  });

  it('saves the answers, logs them and moves on to Permissions', async () => {
    const { getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('profile-tipo-represa_acude'));
    await fireEvent.press(getByTestId('profile-uf-PI'));
    await fireEvent.press(getByTestId('onboarding-profile-done'));

    expect(mockedTrack).toHaveBeenCalledWith('onboarding_completed', { tipo_pesca: 'represa_acude', estado: 'PI' });
    expect(mockedSetUserProperties).toHaveBeenCalledWith({ tipo_pesca: 'represa_acude', uf: 'PI' });
    expect(useProfileStore.getState()).toMatchObject({ tipoPesca: 'represa_acude', estado: 'PI' });
    expect(replaceMock).toHaveBeenCalledWith('Permissions');
  });

  it('"Pular" ignores any selection and logs nao_informado', async () => {
    const { getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('profile-uf-SP'));
    await fireEvent.press(getByTestId('onboarding-profile-skip'));

    expect(mockedTrack).toHaveBeenCalledWith('onboarding_completed', { tipo_pesca: 'nao_informado', estado: 'nao_informado' });
    expect(replaceMock).toHaveBeenCalledWith('Permissions');
  });

  it('tapping a selected option again clears it', async () => {
    const { getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('profile-tipo-mar'));
    await fireEvent.press(getByTestId('profile-tipo-mar'));
    await fireEvent.press(getByTestId('onboarding-profile-done'));

    expect(mockedTrack).toHaveBeenCalledWith('onboarding_completed', { tipo_pesca: 'nao_informado', estado: 'nao_informado' });
  });

  it('restores a saved profile and ignores junk', async () => {
    await AsyncStorage.setItem('peguei:profile', JSON.stringify({ tipoPesca: 'rio', estado: 'XX' }));
    await useProfileStore.getState().hydrate();

    expect(useProfileStore.getState()).toMatchObject({ tipoPesca: 'rio', estado: 'nao_informado' });
  });
});
