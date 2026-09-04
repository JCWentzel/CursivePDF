import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
import { getDevicePixelRatio, resizeCanvas } from "$lib/pdf/renderer";
import type { InkStroke } from "./types";

export function renderInkCanvas(
  canvas: HTMLCanvasElement,
  viewport: PageViewport,
  strokes: InkStroke[],
  activeStroke: InkStroke | null,
): void {
  const pixelRatio = getDevicePixelRatio();
  resizeCanvas(canvas, viewport.width, viewport.height, pixelRatio);

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, viewport.width, viewport.height);

  for (const stroke of strokes) {
    drawStroke(context, viewport, stroke);
  }

  if (activeStroke) {
    drawStroke(context, viewport, activeStroke);
  }
}

function drawStroke(context: CanvasRenderingContext2D, viewport: PageViewport, stroke: InkStroke): void {
  if (stroke.points.length === 0) {
    return;
  }

  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = toRgba(stroke.color, stroke.opacity);
  context.fillStyle = toRgba(stroke.color, stroke.opacity);

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    const [x, y] = viewport.convertToViewportPoint(point.x, point.y);
    context.beginPath();
    context.arc(x, y, getViewportStrokeWidth(stroke, viewport, point.pressure) / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }

  for (let index = 1; index < stroke.points.length; index += 1) {
    const start = stroke.points[index - 1];
    const end = stroke.points[index];
    const [startX, startY] = viewport.convertToViewportPoint(start.x, start.y);
    const [endX, endY] = viewport.convertToViewportPoint(end.x, end.y);

    context.lineWidth = getViewportStrokeWidth(stroke, viewport, (start.pressure + end.pressure) / 2);
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();
  }
}

function getViewportStrokeWidth(stroke: InkStroke, viewport: PageViewport, pressure: number): number {
  return Math.max(0.5, stroke.width * viewport.scale * pressure);
}

function toRgba(hex: string, opacity: number): string {
  const { r, g, b } = parseHexColor(hex);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const color = hex.replace("#", "").trim();
  const normalized =
    color.length === 3
      ? color
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : color.padEnd(6, "0").slice(0, 6);

  const value = Number.parseInt(normalized, 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}
