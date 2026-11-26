import AsyncStorage from '@react-native-async-storage/async-storage';
import InAppReview from 'react-native-in-app-review';
import { track } from '../../../analytics';
import {
  REVIEW_INTERVAL_MS,
  maybePromptReview,
  recordVideoSaved,
  shouldPromptReview,
} from '../reviewPrompt';

const mockedTrack = track as jest.Mock;

describe('reviewPrompt', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('is due from the 3rd saved video, then every 90 days', () => {
    expect(shouldPromptReview({ savedVideos: 2, lastPromptAt: null }, 0)).toBe(false);
    expect(shouldPromptReview({ savedVideos: 3, lastPromptAt: null }, 0)).toBe(true);
    expect(shouldPromptReview({ savedVideos: 9, lastPromptAt: 0 }, REVIEW_INTERVAL_MS - 1)).toBe(false);
    expect(shouldPromptReview({ savedVideos: 9, lastPromptAt: 0 }, REVIEW_INTERVAL_MS)).toBe(true);
  });

  it('asks once after three saves and not again within 90 days', async () => {
    await Promise.all([recordVideoSaved(), recordVideoSaved()]);
    expect(await maybePromptReview(1000)).toBe(false);

    await recordVideoSaved();
    expect(await maybePromptReview(1000)).toBe(true);
    expect(InAppReview.RequestInAppReview).toHaveBeenCalledTimes(1);
    expect(mockedTrack).toHaveBeenCalledWith('review_prompt_shown');

    expect(await maybePromptReview(1000 + REVIEW_INTERVAL_MS - 1)).toBe(false);
    expect(await maybePromptReview(1000 + REVIEW_INTERVAL_MS)).toBe(true);
  });

  it('does nothing when the store review is unavailable', async () => {
    (InAppReview.isAvailable as jest.Mock).mockReturnValueOnce(false);
    await recordVideoSaved();
    await recordVideoSaved();
    await recordVideoSaved();

    expect(await maybePromptReview(0)).toBe(false);
    expect(mockedTrack).not.toHaveBeenCalled();
  });
});
