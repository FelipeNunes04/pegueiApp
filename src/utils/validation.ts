export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

export function isWithinRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}
