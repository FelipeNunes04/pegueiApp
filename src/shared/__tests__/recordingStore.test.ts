import { useRecordingStore } from '../store/recordingStore';
import type { SavedClip } from '../types/index';

const makeClip = (id: string): SavedClip => ({
  id,
  path: `/clips/${id}.mp4`,
  createdAt: Date.now(),
  durationSeconds: 10,
  triggeredBy: 'manual',
});

describe('recordingStore', () => {
  beforeEach(() => {
    useRecordingStore.setState({ phase: 'idle', errorMessage: null, clips: [] });
  });

  it('setError also flips phase to "error"', () => {
    useRecordingStore.getState().setError('câmera ocupada');
    const state = useRecordingStore.getState();
    expect(state.errorMessage).toBe('câmera ocupada');
    expect(state.phase).toBe('error');
  });

  it('clearError resets the message without touching phase', () => {
    useRecordingStore.getState().setError('boom');
    useRecordingStore.getState().setPhase('buffering');
    useRecordingStore.getState().clearError();
    expect(useRecordingStore.getState().errorMessage).toBeNull();
    expect(useRecordingStore.getState().phase).toBe('buffering');
  });

  it('addClip prepends new clips (most recent first)', () => {
    useRecordingStore.getState().addClip(makeClip('a'));
    useRecordingStore.getState().addClip(makeClip('b'));
    expect(useRecordingStore.getState().clips.map(c => c.id)).toEqual(['b', 'a']);
  });

  it('removeClip drops only the matching id', () => {
    useRecordingStore.getState().addClip(makeClip('a'));
    useRecordingStore.getState().addClip(makeClip('b'));
    useRecordingStore.getState().removeClip('a');
    expect(useRecordingStore.getState().clips.map(c => c.id)).toEqual(['b']);
  });

  it('setClips replaces the whole list', () => {
    useRecordingStore.getState().addClip(makeClip('a'));
    useRecordingStore.getState().setClips([makeClip('x'), makeClip('y')]);
    expect(useRecordingStore.getState().clips.map(c => c.id)).toEqual(['x', 'y']);
  });
});
