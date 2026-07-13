import { computeZoomPillLevels, nearestZoomLevelIndex } from '../../src/utils/zoom';

describe('computeZoomPillLevels', () => {
  it('includes 0.5x only when the device has an ultra-wide lens', () => {
    expect(computeZoomPillLevels(4, true)).toEqual([0.5, 1, 2]);
    expect(computeZoomPillLevels(4, false)).toEqual([1, 2]);
  });

  it('omits 2x when the device cannot zoom that far', () => {
    expect(computeZoomPillLevels(1.5, false)).toEqual([1]);
    expect(computeZoomPillLevels(1.5, true)).toEqual([0.5, 1]);
  });
});

describe('nearestZoomLevelIndex', () => {
  it('picks the closest level to the current factor', () => {
    const levels = [0.5, 1, 2];
    expect(nearestZoomLevelIndex(levels, 0.6)).toBe(0);
    expect(nearestZoomLevelIndex(levels, 1.4)).toBe(1);
    expect(nearestZoomLevelIndex(levels, 1.8)).toBe(2);
  });
});
