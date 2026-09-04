import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
import { getDevicePixelRatio, resizeCanvas } from "./renderer";

export async function renderPdfThumbnail(
  document: PDFDocumentProxy,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  maxWidth: number,
): Promise<PageViewport> {
  const page = await document.getPage(pageIndex + 1);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = maxWidth / baseViewport.width;
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Could not create a canvas context for thumbnail rendering.");
  }

  const pixelRatio = getDevicePixelRatio();
  resizeCanvas(canvas, viewport.width, viewport.height, pixelRatio);

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvas: null,
    canvasContext: context,
    viewport,
    transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
    background: "#ffffff",
  }).promise;

  return viewport;
}
