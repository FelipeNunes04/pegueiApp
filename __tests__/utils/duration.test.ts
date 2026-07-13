import { formatClipTimestamp, formatDuration } from '../../src/utils/duration';

describe('formatDuration', () => {
  it('formats seconds under a minute', () => {
    expect(formatDuration(45)).toBe('0:45');
  });

  it('formats minutes and seconds with zero-padding', () => {
    expect(formatDuration(65)).toBe('1:05');
  });

  it('rounds fractional seconds', () => {
    expect(formatDuration(59.6)).toBe('1:00');
  });

  it('never goes negative', () => {
    expect(formatDuration(-10)).toBe('0:00');
  });
});

describe('formatClipTimestamp', () => {
  it('formats an epoch millis timestamp as YYYY-MM-DD HH:mm', () => {
    const date = new Date(2026, 0, 5, 9, 3); // Jan 5 2026, 09:03 local time
    expect(formatClipTimestamp(date.getTime())).toBe('2026-01-05 09:03');
  });
});
