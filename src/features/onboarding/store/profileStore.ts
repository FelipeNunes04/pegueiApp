import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { UFS, setUserProperties, type Estado, type TipoPesca } from '../../../analytics';

/**
 * The optional "how do you fish / where" answers from onboarding. Used only
 * as analytics user properties (and later to tailor tips); never sent with
 * a location. Persisted so the sponsorship and tips features can read it.
 */
const STORAGE_KEY = 'peguei:profile';

const TIPOS: readonly TipoPesca[] = ['rio', 'represa_acude', 'mar', 'pesqueiro', 'varios', 'nao_informado'];

export interface FishingProfile {
  tipoPesca: TipoPesca;
  estado: Estado;
}

interface ProfileState extends FishingProfile {
  hydrate: () => Promise<void>;
  saveProfile: (profile: FishingProfile) => void;
}

const EMPTY: FishingProfile = { tipoPesca: 'nao_informado', estado: 'nao_informado' };

function isTipo(value: unknown): value is TipoPesca {
  return typeof value === 'string' && (TIPOS as readonly string[]).includes(value);
}

function isEstado(value: unknown): value is Estado {
  return value === 'nao_informado' || (typeof value === 'string' && (UFS as readonly string[]).includes(value));
}

export const useProfileStore = create<ProfileState>(set => ({
  ...EMPTY,
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') {
        const { tipoPesca, estado } = parsed as Record<string, unknown>;
        set({ tipoPesca: isTipo(tipoPesca) ? tipoPesca : 'nao_informado', estado: isEstado(estado) ? estado : 'nao_informado' });
      }
    } catch {
      // Keep the defaults.
    }
  },
  saveProfile: profile => {
    set(profile);
    setUserProperties({ tipo_pesca: profile.tipoPesca, uf: profile.estado });
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profile)).catch(() => undefined);
  },
}));
