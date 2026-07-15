/**
 * The fixed zoom levels shown as pills, derived from what the hardware
 * actually supports -- 0.5x only appears when the device reports an
 * ultra-wide lens (`hasUltraWide`), and 2x only appears when the device's
 * max zoom actually reaches it, so a pill is never shown that wouldn't do
 * anything on the current device.
 */
export function computeZoomPillLevels(maxZoom: number, hasUltraWide: boolean): number[] {
  const levels: number[] = [];
  if (hasUltraWide) {
    levels.push(0.5);
  }
  levels.push(1);
  if (maxZoom >= 2) {
    levels.push(2);
  }
  return levels;
}

/** Index of the pill level closest to the current zoom factor, for pinch-to-zoom highlighting. */
export function nearestZoomLevelIndex(levels: number[], factor: number): number {
  let closestIndex = 0;
  let closestDistance = Infinity;
  levels.forEach((level, index) => {
    const distance = Math.abs(level - factor);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  return closestIndex;
}
