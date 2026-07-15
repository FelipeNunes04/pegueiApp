import { create } from 'zustand';
import type { RecordingPhase, SavedClip } from '../types/index';

interface RecordingState {
  phase: RecordingPhase;
  errorMessage: string | null;
  clips: SavedClip[];
  setPhase: (phase: RecordingPhase) => void;
  setError: (message: string) => void;
  clearError: () => void;
  addClip: (clip: SavedClip) => void;
  setClips: (clips: SavedClip[]) => void;
  removeClip: (id: string) => void;
}

export const useRecordingStore = create<RecordingState>(set => ({
  phase: 'idle',
  errorMessage: null,
  clips: [],
  setPhase: phase => set({ phase }),
  setError: message => set({ errorMessage: message, phase: 'error' }),
  clearError: () => set({ errorMessage: null }),
  addClip: clip => set(state => ({ clips: [clip, ...state.clips] })),
  setClips: clips => set({ clips }),
  removeClip: id => set(state => ({ clips: state.clips.filter(c => c.id !== id) })),
}));
