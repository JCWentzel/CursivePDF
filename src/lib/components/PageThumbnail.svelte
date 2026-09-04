<script lang="ts">
  import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
  import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
  import { renderInkCanvas } from "$lib/ink/canvas";
  import type { InkStroke } from "$lib/ink/types";
  import { renderPdfThumbnail } from "$lib/pdf/thumbnails";

  type Props = {
    pdfDocument: PDFDocumentProxy;
    pageIndex: number;
    active: boolean;
    strokes: InkStroke[];
    onselect: () => void;
  };

  let { pdfDocument, pageIndex, active, strokes, onselect }: Props = $props();

  let pdfCanvas = $state<HTMLCanvasElement | null>(null);
  let inkCanvas = $state<HTMLCanvasElement | null>(null);
  let viewport = $state<PageViewport | null>(null);
  let renderToken = 0;

  const THUMB_WIDTH = 78;

  let thumbStyle = $derived(viewport ? `width: ${viewport.width}px; height: ${viewport.height}px;` : "");
  let inked = $derived(strokes.length > 0);

  $effect(() => {
    const document = pdfDocument;
    const canvas = pdfCanvas;
    const index = pageIndex;

    if (!document || !canvas) {
      return;
    }

    const token = ++renderToken;

    void renderPdfThumbnail(document, index, canvas, THUMB_WIDTH)
      .then((nextViewport) => {
        if (token === renderToken) {
          viewport = nextViewport;
        }
      })
      .catch(() => {
        if (token === renderToken) {
          viewport = null;
        }
      });
  });

  $effect(() => {
    if (!viewport || !inkCanvas) {
      return;
    }

    renderInkCanvas(inkCanvas, viewport, strokes, null);
  });
</script>

<button
  type="button"
  class="page-thumb"
  class:active
  class:inked
  onclick={onselect}
  aria-label={`Page ${pageIndex + 1}`}
>
  <span class="thumb-paper" style={thumbStyle}>
    <canvas bind:this={pdfCanvas} class="thumb-pdf" aria-hidden="true"></canvas>
    <canvas bind:this={inkCanvas} class="thumb-ink" aria-hidden="true"></canvas>
  </span>
  <span class="page-number">{pageIndex + 1}</span>
</button>

<style>
  .page-thumb {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 7px;
    width: 102px;
    min-height: 126px;
    padding: 8px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    color: var(--text);
    background: var(--button-bg);
    font-weight: 800;
  }

  .page-thumb:hover {
    border-color: var(--accent);
  }

  .page-thumb.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  .page-thumb.inked::after {
    position: absolute;
    top: 9px;
    right: 9px;
    width: 9px;
    height: 9px;
    border: 2px solid var(--button-bg);
    border-radius: 50%;
    background: var(--success);
    content: "";
  }

  .thumb-paper {
    position: relative;
    display: block;
    width: 78px;
    height: 102px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: #ffffff;
    box-shadow: 0 6px 12px rgba(15, 23, 42, 0.12);
  }

  .thumb-pdf,
  .thumb-ink {
    position: absolute;
    inset: 0;
    display: block;
  }

  .thumb-pdf {
    z-index: 1;
  }

  .thumb-ink {
    z-index: 2;
  }

  .page-number {
    color: var(--muted);
    font-size: 0.78rem;
  }
</style>
