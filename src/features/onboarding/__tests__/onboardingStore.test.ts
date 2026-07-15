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
