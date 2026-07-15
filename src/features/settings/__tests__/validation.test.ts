import { clamp, isWithinRange } from '../utils/validation';

describe('clamp', () => {
  it('returns the value unchanged when within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to the minimum when below range', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps to the maximum when above range', () => {
    expect(clamp(50, 0, 10)).toBe(10);
  });

  it('falls back to min for NaN input', () => {
    expect(clamp(NaN, 2, 10)).toBe(2);
  });

  it('is inclusive of both bounds', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe('isWithinRange', () => {
  it('is true for values inside the inclusive range', () => {
    expect(isWithinRange(5, 0, 10)).toBe(true);
    expect(isWithinRange(0, 0, 10)).toBe(true);
    expect(isWithinRange(10, 0, 10)).toBe(true);
  });

  it('is false for values outside the range', () => {
    expect(isWithinRange(-1, 0, 10)).toBe(false);
    expect(isWithinRange(11, 0, 10)).toBe(false);
  });
});
