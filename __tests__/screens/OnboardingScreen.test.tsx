import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import analytics from '@react-native-firebase/analytics';
import { OnboardingScreen } from '../../src/screens/OnboardingScreen';
import { useOnboardingStore } from '../../src/store/onboardingStore';

const replaceMock = jest.fn();
const fakeNavigation = { replace: replaceMock } as never;
const mockedLogEvent = analytics().logEvent as jest.Mock;

describe('OnboardingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useOnboardingStore.setState({ hydrated: true, hasCompletedOnboarding: false });
  });

  it('renders the first slide and every slide is present in the scroll content', async () => {
    const { getByTestId } = await render(<OnboardingScreen navigation={fakeNavigation} route={{} as never} />);

    expect(getByTestId('onboarding-slide-buffer')).toBeTruthy();
    expect(getByTestId('onboarding-slide-tap')).toBeTruthy();
    expect(getByTestId('onboarding-slide-versatility')).toBeTruthy();
    expect(getByTestId('onboarding-slide-welcome')).toBeTruthy();
  });

  it('"Pular" completes onboarding and navigates straight to Permissions', async () => {
    const { getByTestId } = await render(<OnboardingScreen navigation={fakeNavigation} route={{} as never} />);

    await act(async () => {
      fireEvent.press(getByTestId('onboarding-skip'));
    });

    expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(true);
    expect(replaceMock).toHaveBeenCalledWith('Permissions');
    expect(mockedLogEvent).toHaveBeenCalledWith('onboarding_skipped');
  });

  it('never mentions paid plans or subscriptions anywhere in the copy', async () => {
    const { queryByText } = await render(<OnboardingScreen navigation={fakeNavigation} route={{} as never} />);

    expect(queryByText(/assinatura|premium|plano pago|upgrade/i)).toBeNull();
  });
});
