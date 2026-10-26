import { create } from 'zustand';
import type { BufferHealth, RecordingPhase, SavedClip } from '../types/index';

interface RecordingState {
  phase: RecordingPhase;
  errorMessage: string | null;
  clips: SavedClip[];
  /**
   * Lives next to phase (rather than in cameraStore) because it describes
   * the same native buffer lifecycle phase does -- useCircularBuffer owns
   * both, resets this to 'healthy' on every start()/stop(), and updates it
   * from the CircularBufferHealth event in between.
   */
  bufferHealth: BufferHealth;
  setBufferHealth: (health: BufferHealth) => void;
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
  bufferHealth: 'healthy',
  setBufferHealth: health => set({ bufferHealth: health }),
  setPhase: phase => set({ phase }),
  setError: message => set({ errorMessage: message, phase: 'error' }),
  clearError: () => set({ errorMessage: null }),
  addClip: clip => set(state => ({ clips: [clip, ...state.clips] })),
  setClips: clips => set({ clips }),
  removeClip: id => set(state => ({ clips: state.clips.filter(c => c.id !== id) })),
}));
