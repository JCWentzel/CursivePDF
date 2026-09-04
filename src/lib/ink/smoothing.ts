import type { InkPoint } from "./types";

export function smoothInkPoint(point: InkPoint, previousPoints: InkPoint[], smoothing: number): InkPoint {
  if (previousPoints.length === 0 || smoothing <= 0) {
    return point;
  }

  const strength = Math.min(100, Math.max(0, smoothing)) / 100;
  const followFactor = 1 - strength * 0.86;
  const previous = previousPoints[previousPoints.length - 1];

  return {
    ...point,
    x: previous.x + (point.x - previous.x) * followFactor,
    y: previous.y + (point.y - previous.y) * followFactor,
    pressure: previous.pressure + (point.pressure - previous.pressure) * followFactor,
  };
}
