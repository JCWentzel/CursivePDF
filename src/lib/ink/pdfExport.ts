import { LineCapStyle, PDFDocument, rgb, type PDFPage } from "pdf-lib";
import type { InkPoint, InkStroke } from "./types";

export async function exportPdfWithInk(originalPdfBytes: Uint8Array, strokes: InkStroke[]): Promise<Uint8Array> {
  const pdfDocument = await PDFDocument.load(new Uint8Array(originalPdfBytes));
  const pages = pdfDocument.getPages();

  for (const stroke of strokes) {
    const page = pages[stroke.pageIndex];

    if (!page) {
      continue;
    }

    drawStroke(page, stroke);
  }

  return await pdfDocument.save();
}

function drawStroke(page: PDFPage, stroke: InkStroke): void {
  const color = parsePdfColor(stroke.color);
  const opacity = clamp(stroke.opacity, 0, 1);

  if (stroke.points.length === 0) {
    return;
  }

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    const diameter = getPdfStrokeWidth(stroke, point.pressure);

    page.drawEllipse({
      x: point.x,
      y: point.y,
      xScale: diameter / 2,
      yScale: diameter / 2,
      color,
      opacity,
    });
    return;
  }

  for (let index = 1; index < stroke.points.length; index += 1) {
    const start = stroke.points[index - 1];
    const end = stroke.points[index];

    if (start.x === end.x && start.y === end.y) {
      continue;
    }

    page.drawLine({
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      thickness: getPdfStrokeWidth(stroke, (start.pressure + end.pressure) / 2),
      color,
      opacity,
      lineCap: LineCapStyle.Round,
    });
  }
}

function getPdfStrokeWidth(stroke: InkStroke, pressure: number): number {
  return Math.max(0.25, stroke.width * clamp(pressure, 0.08, 1));
}

function parsePdfColor(hex: string) {
  const color = hex.replace("#", "").trim();
  const normalized =
    color.length === 3
      ? color
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : color.padEnd(6, "0").slice(0, 6);
  const value = Number.parseInt(normalized, 16);

  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
