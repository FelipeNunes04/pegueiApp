import React from 'react';
import { Dimensions, ScrollView, StyleSheet } from 'react-native';
import { act, fireEvent, render as baseRender, type RenderOptions } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import analytics from '@react-native-firebase/analytics';
import { OnboardingScreen } from '../OnboardingScreen';
import { useOnboardingStore } from '../store/onboardingStore';

const replaceMock = jest.fn();
const fakeNavigation = { replace: replaceMock } as never;
const mockedLogEvent = analytics().logEvent as jest.Mock;
const STATUS_BAR_INSET = 59;
const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: STATUS_BAR_INSET, right: 0, bottom: 34, left: 0 },
};

function SafeAreaWrapper({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider initialMetrics={safeAreaMetrics}>{children}</SafeAreaProvider>;
}

const render = (ui: React.ReactElement, options?: RenderOptions) =>
  baseRender(ui, { wrapper: SafeAreaWrapper, ...options });

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

  it('keeps "Pular" below the status bar', async () => {
    const { getByTestId } = await render(<OnboardingScreen navigation={fakeNavigation} route={{} as never} />);

    expect(StyleSheet.flatten(getByTestId('onboarding-skip').props.style).top).toBeGreaterThanOrEqual(STATUS_BAR_INSET);
  });

  it('never mentions paid plans or subscriptions anywhere in the copy', async () => {
    const { queryByText } = await render(<OnboardingScreen navigation={fakeNavigation} route={{} as never} />);

    expect(queryByText(/assinatura|premium|plano pago|upgrade/i)).toBeNull();
  });

  describe('paging through the slides', () => {
    const width = Dimensions.get('window').width;
    let scrollToSpy: jest.SpyInstance;

    beforeEach(() => {
      scrollToSpy = jest.spyOn(ScrollView.prototype, 'scrollTo');
    });

    afterEach(() => {
      scrollToSpy.mockRestore();
    });

    // The ScrollView reports which page the user landed on (after a swipe
    // or an animated scrollTo) via onMomentumScrollEnd.
    const landOnPage = (scroll: Parameters<typeof fireEvent>[0], page: number) =>
      fireEvent(scroll, 'momentumScrollEnd', {
        nativeEvent: { contentOffset: { x: page * width, y: 0 } },
      });

    it('"Próximo" scrolls to the next slide without leaving onboarding', async () => {
      const { getByTestId, getByText } = await render(
        <OnboardingScreen navigation={fakeNavigation} route={{} as never} />,
      );
      expect(getByText('Próximo')).toBeTruthy();

      await fireEvent.press(getByTestId('onboarding-next'));

      expect(scrollToSpy).toHaveBeenCalledWith({ x: width, animated: true });
      expect(replaceMock).not.toHaveBeenCalled();
      expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(false);
    });

    it('"Próximo" scrolls relative to the page the user swiped to', async () => {
      const { getByTestId } = await render(
        <OnboardingScreen navigation={fakeNavigation} route={{} as never} />,
      );

      await landOnPage(getByTestId('onboarding-scroll'), 2);
      await fireEvent.press(getByTestId('onboarding-next'));

      expect(scrollToSpy).toHaveBeenCalledWith({ x: 3 * width, animated: true });
    });

    it('on the last slide, hides "Pular" and turns the button into "Continuar"', async () => {
      const { getByTestId, getByText, queryByTestId, queryByText } = await render(
        <OnboardingScreen navigation={fakeNavigation} route={{} as never} />,
      );

      await landOnPage(getByTestId('onboarding-scroll'), 3);

      expect(queryByTestId('onboarding-skip')).toBeNull();
      expect(getByText('Continuar')).toBeTruthy();
      expect(queryByText('Próximo')).toBeNull();
    });

    it('"Continuar" on the last slide completes onboarding, logs it, and goes to Permissions', async () => {
      const { getByTestId } = await render(
        <OnboardingScreen navigation={fakeNavigation} route={{} as never} />,
      );

      await landOnPage(getByTestId('onboarding-scroll'), 3);
      await fireEvent.press(getByTestId('onboarding-next'));

      expect(scrollToSpy).not.toHaveBeenCalled();
      expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(true);
      expect(replaceMock).toHaveBeenCalledWith('Permissions');
      expect(mockedLogEvent).toHaveBeenCalledWith('onboarding_completed');
      expect(mockedLogEvent).not.toHaveBeenCalledWith('onboarding_skipped');
    });

    it('swiping back from the last slide restores "Pular" and "Próximo"', async () => {
      const { getByTestId, getByText } = await render(
        <OnboardingScreen navigation={fakeNavigation} route={{} as never} />,
      );

      await landOnPage(getByTestId('onboarding-scroll'), 3);
      await landOnPage(getByTestId('onboarding-scroll'), 1);

      expect(getByTestId('onboarding-skip')).toBeTruthy();
      expect(getByText('Próximo')).toBeTruthy();
    });

    it('snaps a partial scroll offset to the nearest page', async () => {
      const { getByTestId, getByText } = await render(
        <OnboardingScreen navigation={fakeNavigation} route={{} as never} />,
      );

      await fireEvent(getByTestId('onboarding-scroll'), 'momentumScrollEnd', {
        nativeEvent: { contentOffset: { x: 2.6 * width, y: 0 } },
      });

      expect(getByText('Continuar')).toBeTruthy();
    });
  });
});
