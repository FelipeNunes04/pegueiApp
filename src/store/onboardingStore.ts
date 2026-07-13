import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'peguei:onboardingCompleted';

interface OnboardingState {
  hydrated: boolean;
  hasCompletedOnboarding: boolean;
  hydrate: () => Promise<void>;
  completeOnboarding: () => void;
}

/** Whether the user has ever finished the onboarding flow, persisted across launches so it only shows once. See DECISIONS.md. */
export const useOnboardingStore = create<OnboardingState>((set) => ({
  hydrated: false,
  hasCompletedOnboarding: false,
  hydrate: async () => {
    let completed = false;
    try {
      completed = (await AsyncStorage.getItem(STORAGE_KEY)) === 'true';
    } catch {
      completed = false;
    }
    set({ hasCompletedOnboarding: completed, hydrated: true });
  },
  completeOnboarding: () => {
    set({ hasCompletedOnboarding: true });
    AsyncStorage.setItem(STORAGE_KEY, 'true').catch(() => undefined);
  },
}));
