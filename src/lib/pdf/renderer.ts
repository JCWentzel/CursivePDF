import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PdfPageRender = {
  page: PDFPageProxy;
  viewport: PageViewport;
  scale: number;
};

export async function loadPdfDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const loadingTask = getDocument({ data: new Uint8Array(bytes) });
  return await loadingTask.promise;
}

export async function renderPdfPage(
  document: PDFDocumentProxy,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<PdfPageRender> {
  const page = await document.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Could not create a canvas context for PDF rendering.");
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

  return { page, viewport, scale };
}

export function resizeCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  pixelRatio = getDevicePixelRatio(),
): void {
  const width = Math.max(1, Math.ceil(cssWidth * pixelRatio));
  const height = Math.max(1, Math.ceil(cssHeight * pixelRatio));

  if (canvas.width !== width) {
    canvas.width = width;
  }

  if (canvas.height !== height) {
    canvas.height = height;
  }

  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
}

export function getDevicePixelRatio(): number {
  return Math.max(1, window.devicePixelRatio || 1);
}
