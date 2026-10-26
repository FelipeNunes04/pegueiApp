import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOnboardingStore } from '../store/onboardingStore';

describe('onboardingStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useOnboardingStore.setState({
      hydrated: false,
      hasCompletedOnboarding: false,
    });
  });

  it('starts unhydrated and not completed', () => {
    const state = useOnboardingStore.getState();
    expect(state.hydrated).toBe(false);
    expect(state.hasCompletedOnboarding).toBe(false);
  });

  it('hydrate() reads a previously completed flag from storage', async () => {
    await AsyncStorage.setItem('peguei:onboardingCompleted', 'true');

    await useOnboardingStore.getState().hydrate();

    const state = useOnboardingStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.hasCompletedOnboarding).toBe(true);
  });

  it('hydrate() defaults to not completed when nothing is stored', async () => {
    await useOnboardingStore.getState().hydrate();

    const state = useOnboardingStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.hasCompletedOnboarding).toBe(false);
  });

  it('completeOnboarding() flips the flag and persists it', async () => {
    useOnboardingStore.getState().completeOnboarding();

    expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(true);
    await expect(
      AsyncStorage.getItem('peguei:onboardingCompleted'),
    ).resolves.toBe('true');
  });
});

describe('onboardingStore storage failures', () => {
  beforeEach(() => {
    useOnboardingStore.setState({ hydrated: false, hasCompletedOnboarding: false });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hydrate() still finishes (as not completed) when storage cannot be read, so the app never hangs on a blank screen', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk I/O'));

    await useOnboardingStore.getState().hydrate();

    const state = useOnboardingStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.hasCompletedOnboarding).toBe(false);
  });

  it('hydrate() treats any stored value other than "true" as not completed', async () => {
    await AsyncStorage.setItem('peguei:onboardingCompleted', 'false');

    await useOnboardingStore.getState().hydrate();

    expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(false);
  });

  it('completeOnboarding() still flips the in-memory flag when persisting fails', async () => {
    const setItem = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('disk full'));

    expect(() => useOnboardingStore.getState().completeOnboarding()).not.toThrow();
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(setItem).toHaveBeenCalled();
    expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(true);
  });
});
