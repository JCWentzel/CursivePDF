import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
import type { InkPoint, InkStroke } from "./types";

export function pointerEventToInkPoint(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  viewport: PageViewport,
): InkPoint {
  const rect = canvas.getBoundingClientRect();
  const viewportX = clamp(((event.clientX - rect.left) / rect.width) * viewport.width, 0, viewport.width);
  const viewportY = clamp(((event.clientY - rect.top) / rect.height) * viewport.height, 0, viewport.height);
  const [x, y] = viewport.convertToPdfPoint(viewportX, viewportY);

  return {
    x,
    y,
    pressure: normalizePressure(event),
    time: event.timeStamp,
    pointerType: event.pointerType || "mouse",
    tiltX: event.tiltX,
    tiltY: event.tiltY,
  };
}

export function distanceBetweenPoints(a: InkPoint, b: InkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function findTopmostStrokeHit(
  strokes: InkStroke[],
  pageIndex: number,
  point: InkPoint,
  tolerance: number,
): InkStroke | null {
  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    const stroke = strokes[index];

    if (stroke.pageIndex !== pageIndex) {
      continue;
    }

    const hitTolerance = tolerance + stroke.width / 2;
    if (distanceToStroke(point, stroke) <= hitTolerance) {
      return stroke;
    }
  }

  return null;
}

export function distanceToStroke(point: InkPoint, stroke: InkStroke): number {
  if (stroke.points.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  if (stroke.points.length === 1) {
    return distanceBetweenPoints(point, stroke.points[0]);
  }

  let shortest = Number.POSITIVE_INFINITY;

  for (let index = 1; index < stroke.points.length; index += 1) {
    shortest = Math.min(shortest, distanceToSegment(point, stroke.points[index - 1], stroke.points[index]));
  }

  return shortest;
}

function distanceToSegment(point: InkPoint, start: InkPoint, end: InkPoint): number {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (segmentLengthSquared === 0) {
    return distanceBetweenPoints(point, start);
  }

  const t = clamp(
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / segmentLengthSquared,
    0,
    1,
  );
  const projection = {
    ...point,
    x: start.x + t * segmentX,
    y: start.y + t * segmentY,
  };

  return distanceBetweenPoints(point, projection);
}

function normalizePressure(event: PointerEvent): number {
  if (event.pointerType === "pen") {
    return clamp(event.pressure || 0.5, 0.08, 1);
  }

  if (event.pressure > 0 && event.pressure <= 1) {
    return clamp(event.pressure, 0.08, 1);
  }

  return 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
