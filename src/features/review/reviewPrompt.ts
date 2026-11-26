import AsyncStorage from '@react-native-async-storage/async-storage';
import InAppReview from 'react-native-in-app-review';
import { track } from '../../analytics';

/**
 * Native review prompt (SKStoreReviewController / Play In-App Review) after
 * the 3rd saved video, at most once every 90 days.
 *
 * Saves are counted on save, but the prompt is only asked for when the
 * gallery opens: a dialog over the camera could make the user miss the next
 * catch. The OS decides whether the dialog really shows (Apple caps it at 3
 * times a year), so review_prompt_shown means "asked for".
 */
const STORAGE_KEY = 'peguei:reviewPrompt';
export const REVIEW_MIN_SAVED_VIDEOS = 3;
export const REVIEW_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;

export interface ReviewPromptState {
  savedVideos: number;
  lastPromptAt: number | null;
}

const INITIAL: ReviewPromptState = { savedVideos: 0, lastPromptAt: null };

export function shouldPromptReview(state: ReviewPromptState, now: number): boolean {
  if (state.savedVideos < REVIEW_MIN_SAVED_VIDEOS) return false;
  return state.lastPromptAt === null || now - state.lastPromptAt >= REVIEW_INTERVAL_MS;
}

async function load(): Promise<ReviewPromptState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return INITIAL;
    const { savedVideos, lastPromptAt } = parsed as Partial<ReviewPromptState>;
    return {
      savedVideos: typeof savedVideos === 'number' ? savedVideos : 0,
      lastPromptAt: typeof lastPromptAt === 'number' ? lastPromptAt : null,
    };
  } catch {
    return INITIAL;
  }
}

async function save(state: ReviewPromptState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Losing the counter only delays the prompt.
  }
}

// Serialises read-modify-write so two quick saves both count.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

export function recordVideoSaved(): Promise<void> {
  return serial(async () => {
    const state = await load();
    await save({ ...state, savedVideos: state.savedVideos + 1 });
  });
}

/** Asks the OS for the review dialog when due. Resolves true when it was asked for. */
export function maybePromptReview(now: number = Date.now()): Promise<boolean> {
  return serial(async () => {
    const state = await load();
    if (!shouldPromptReview(state, now)) return false;
    let available = false;
    try {
      available = InAppReview.isAvailable();
    } catch {
      available = false;
    }
    if (!available) return false;
    await save({ ...state, lastPromptAt: now });
    track('review_prompt_shown');
    InAppReview.RequestInAppReview().catch(() => undefined);
    return true;
  });
}
