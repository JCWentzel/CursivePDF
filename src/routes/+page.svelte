<script lang="ts">
  import { onMount } from "svelte";
  import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
  import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
  import PageThumbnail from "$lib/components/PageThumbnail.svelte";
  import {
    basename,
    formatFileSize,
    getDefaultExportPath,
    isTauriRuntime,
    openPdfFromDialog,
    savePdfFromDialog,
    type OpenedPdfFile,
  } from "$lib/files/pdfFiles";
  import { renderInkCanvas } from "$lib/ink/canvas";
  import { distanceBetweenPoints, findTopmostStrokeHit, pointerEventToInkPoint } from "$lib/ink/geometry";
  import { exportPdfWithInk } from "$lib/ink/pdfExport";
  import { smoothInkPoint } from "$lib/ink/smoothing";
  import type { InkAction, InkPoint, InkStroke, InkTool, RemovedStroke } from "$lib/ink/types";
  import { loadPdfDocument, renderPdfPage } from "$lib/pdf/renderer";
  import {
    DEFAULT_USER_SETTINGS,
    loadUserSettings,
    normalizeHexColor,
    saveUserSettings,
    type ThemePreference,
  } from "$lib/settings/userSettings";

  const MIN_ZOOM = 50;
  const MAX_ZOOM = 250;
  const ZOOM_STEP = 10;
  const PEN_COLORS = [
    "#101828",
    "#172554",
    "#1e3a8a",
    "#312e81",
    "#4c0519",
    "#6b1432",
    "#064e3b",
    "#3f2d1b",
  ];

  let pdfCanvas = $state<HTMLCanvasElement | null>(null);
  let inkCanvas = $state<HTMLCanvasElement | null>(null);
  let browserFileInput = $state<HTMLInputElement | null>(null);

  let pdfDocument = $state<PDFDocumentProxy | null>(null);
  let pdfBytes = $state<Uint8Array | null>(null);
  let filePath = $state<string | null>(null);
  let fileName = $state("");
  let fileSize = $state(0);
  let pageCount = $state(0);
  let currentPageIndex = $state(0);
  let viewport = $state<PageViewport | null>(null);

  let strokes = $state<InkStroke[]>([]);
  let activeStroke = $state<InkStroke | null>(null);
  let undoStack = $state<InkAction[]>([]);
  let redoStack = $state<InkAction[]>([]);
  let activeTool = $state<InkTool>("draw");
  let activePointerId = $state<number | null>(null);

  let theme = $state<ThemePreference>(DEFAULT_USER_SETTINGS.theme);
  let brushColor = $state(DEFAULT_USER_SETTINGS.brushColor);
  let customColor = $state(DEFAULT_USER_SETTINGS.customColor);
  let draftCustomColor = $state(DEFAULT_USER_SETTINGS.customColor);
  let brushSize = $state(DEFAULT_USER_SETTINGS.brushSize);
  let inkOpacity = $state(DEFAULT_USER_SETTINGS.inkOpacity);
  let smoothing = $state(DEFAULT_USER_SETTINGS.smoothing);
  let zoom = $state(DEFAULT_USER_SETTINGS.zoom);
  let settingsLoaded = $state(false);
  let isColorModalOpen = $state(false);

  let isLoading = $state(false);
  let isRendering = $state(false);
  let isExporting = $state(false);
  let statusMessage = $state("Ready");
  let errorMessage = $state("");
  let renderToken = 0;

  let pageIndexes = $derived(Array.from({ length: pageCount }, (_, index) => index));
  let currentPageStrokes = $derived(strokes.filter((stroke) => stroke.pageIndex === currentPageIndex));
  let pageStyle = $derived(viewport ? `width: ${viewport.width}px; height: ${viewport.height}px;` : "");
  let pageLabel = $derived(pdfDocument ? `${currentPageIndex + 1} of ${pageCount}` : "No document");
  let canExport = $derived(Boolean(pdfDocument && pdfBytes));
  let canUndo = $derived(undoStack.length > 0);
  let canRedo = $derived(redoStack.length > 0);
  let themeToggleLabel = $derived(theme === "dark" ? "Light" : "Dark");

  $effect(() => {
    if (!settingsLoaded) {
      return;
    }

    saveUserSettings({
      theme,
      brushColor,
      customColor,
      brushSize,
      inkOpacity,
      smoothing,
      zoom,
    });
  });

  $effect(() => {
    const document = pdfDocument;
    const canvas = pdfCanvas;
    const pageIndex = currentPageIndex;
    const scale = zoom / 100;

    if (!document || !canvas) {
      viewport = null;
      return;
    }

    const token = ++renderToken;
    isRendering = true;
    errorMessage = "";

    void renderPdfPage(document, pageIndex, canvas, scale)
      .then((result) => {
        if (token !== renderToken) {
          return;
        }

        viewport = result.viewport;
        isRendering = false;
        statusMessage = `${fileName || "PDF"} - page ${pageIndex + 1} ready`;
      })
      .catch((error: unknown) => {
        if (token !== renderToken) {
          return;
        }

        isRendering = false;
        reportError(error, "Could not render this page.");
      });
  });

  $effect(() => {
    const canvas = inkCanvas;
    const currentViewport = viewport;
    const active = activeStroke?.pageIndex === currentPageIndex ? activeStroke : null;

    if (!canvas || !currentViewport) {
      return;
    }

    renderInkCanvas(canvas, currentViewport, currentPageStrokes, active);
  });

  onMount(() => {
    const settings = loadUserSettings();

    theme = settings.theme;
    brushColor = settings.brushColor;
    customColor = settings.customColor;
    draftCustomColor = settings.customColor;
    brushSize = settings.brushSize;
    inkOpacity = settings.inkOpacity;
    smoothing = settings.smoothing;
    zoom = settings.zoom;
    settingsLoaded = true;

    return () => {
      void pdfDocument?.cleanup();
    };
  });

  async function handleOpenPdf(): Promise<void> {
    errorMessage = "";

    if (!isTauriRuntime()) {
      browserFileInput?.click();
      return;
    }

    try {
      isLoading = true;
      const opened = await openPdfFromDialog();

      if (opened) {
        await loadOpenedPdf(opened);
      }
    } catch (error) {
      reportError(error, "Could not open that PDF.");
    } finally {
      isLoading = false;
    }
  }

  async function handleBrowserFileSelected(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";

    if (!file) {
      return;
    }

    try {
      isLoading = true;
      const bytes = new Uint8Array(await file.arrayBuffer());
      await loadOpenedPdf({ path: null, name: file.name, bytes });
    } catch (error) {
      reportError(error, "Could not open that PDF.");
    } finally {
      isLoading = false;
    }
  }

  async function loadOpenedPdf(opened: OpenedPdfFile): Promise<void> {
    const nextBytes = new Uint8Array(opened.bytes);
    const nextDocument = await loadPdfDocument(nextBytes);

    if (pdfDocument) {
      await pdfDocument.cleanup();
    }

    pdfDocument = nextDocument;
    pdfBytes = nextBytes;
    filePath = opened.path;
    fileName = opened.name;
    fileSize = nextBytes.byteLength;
    pageCount = nextDocument.numPages;
    currentPageIndex = 0;
    strokes = [];
    activeStroke = null;
    undoStack = [];
    redoStack = [];
    activePointerId = null;
    statusMessage = `${opened.name} opened`;
  }

  async function handleExportPdf(): Promise<void> {
    if (!pdfBytes || !pdfDocument) {
      return;
    }

    try {
      isExporting = true;
      errorMessage = "";
      statusMessage = "Exporting PDF";
      const output = await exportPdfWithInk(pdfBytes, strokes);

      if (isTauriRuntime()) {
        const savedPath = await savePdfFromDialog(output, filePath ?? fileName);
        statusMessage = savedPath ? `Exported ${basename(savedPath)}` : "Export canceled";
      } else {
        downloadPdf(output, basename(getDefaultExportPath(filePath ?? fileName)));
        statusMessage = "Export downloaded";
      }
    } catch (error) {
      reportError(error, "Could not export this PDF.");
    } finally {
      isExporting = false;
    }
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!pdfDocument || !viewport || !inkCanvas || isRendering) {
      return;
    }

    event.preventDefault();
    activePointerId = event.pointerId;
    capturePointer(event.pointerId);

    const point = pointerEventToInkPoint(event, inkCanvas, viewport);

    if (activeTool === "erase") {
      eraseStrokeAtPoint(point);
      return;
    }

    activeStroke = {
      id: createId(),
      pageIndex: currentPageIndex,
      color: brushColor,
      width: brushSize / viewport.scale,
      opacity: inkOpacity / 100,
      points: [point],
    };
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!pdfDocument || !viewport || !inkCanvas || activePointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    let point = pointerEventToInkPoint(event, inkCanvas, viewport);

    if (activeTool === "erase") {
      eraseStrokeAtPoint(point);
      return;
    }

    if (!activeStroke) {
      return;
    }

    point = smoothInkPoint(point, activeStroke.points, smoothing);
    const lastPoint = activeStroke.points[activeStroke.points.length - 1];
    const minDistance = Math.max(0.2, activeStroke.width * 0.08);

    if (lastPoint && distanceBetweenPoints(lastPoint, point) < minDistance) {
      return;
    }

    activeStroke = {
      ...activeStroke,
      points: [...activeStroke.points, point],
    };
  }

  function handlePointerUp(event: PointerEvent): void {
    if (activePointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    releasePointer(event.pointerId);
    activePointerId = null;
    commitActiveStroke();
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (activePointerId !== event.pointerId) {
      return;
    }

    releasePointer(event.pointerId);
    activePointerId = null;
    commitActiveStroke();
  }

  function commitActiveStroke(): void {
    if (!activeStroke) {
      return;
    }

    const stroke = activeStroke;
    activeStroke = null;
    commitAction({ type: "add", stroke });
    statusMessage = `Page ${stroke.pageIndex + 1}: ${stroke.points.length} point stroke added`;
  }

  function eraseStrokeAtPoint(point: InkPoint): void {
    if (!viewport) {
      return;
    }

    const tolerance = Math.max(8, brushSize * 1.4) / viewport.scale;
    const hit = findTopmostStrokeHit(strokes, currentPageIndex, point, tolerance);

    if (!hit) {
      return;
    }

    const index = strokes.findIndex((stroke) => stroke.id === hit.id);

    if (index < 0) {
      return;
    }

    commitAction({
      type: "erase",
      removed: [{ stroke: strokes[index], index }],
    });
    statusMessage = `Page ${currentPageIndex + 1}: stroke erased`;
  }

  function clearCurrentPage(): void {
    const removed = strokes.reduce<RemovedStroke[]>((items, stroke, index) => {
      if (stroke.pageIndex === currentPageIndex) {
        items.push({ stroke, index });
      }

      return items;
    }, []);

    if (removed.length === 0) {
      return;
    }

    commitAction({ type: "erase", removed });
    statusMessage = `Page ${currentPageIndex + 1}: ink cleared`;
  }

  function undo(): void {
    const action = undoStack[undoStack.length - 1];

    if (!action) {
      return;
    }

    undoStack = undoStack.slice(0, -1);
    strokes = revertAction(strokes, action);
    redoStack = [...redoStack, action];
    activeStroke = null;
    statusMessage = "Undo";
  }

  function redo(): void {
    const action = redoStack[redoStack.length - 1];

    if (!action) {
      return;
    }

    redoStack = redoStack.slice(0, -1);
    strokes = applyAction(strokes, action);
    undoStack = [...undoStack, action];
    activeStroke = null;
    statusMessage = "Redo";
  }

  function commitAction(action: InkAction): void {
    strokes = applyAction(strokes, action);
    undoStack = [...undoStack, action];
    redoStack = [];
  }

  function applyAction(current: InkStroke[], action: InkAction): InkStroke[] {
    if (action.type === "add") {
      return [...current, action.stroke];
    }

    const removedIds = new Set(action.removed.map((item) => item.stroke.id));
    return current.filter((stroke) => !removedIds.has(stroke.id));
  }

  function revertAction(current: InkStroke[], action: InkAction): InkStroke[] {
    if (action.type === "add") {
      return current.filter((stroke) => stroke.id !== action.stroke.id);
    }

    const restored = [...current];

    for (const item of [...action.removed].sort((a, b) => a.index - b.index)) {
      if (restored.some((stroke) => stroke.id === item.stroke.id)) {
        continue;
      }

      restored.splice(Math.min(item.index, restored.length), 0, item.stroke);
    }

    return restored;
  }

  function setPage(pageIndex: number): void {
    if (pageIndex === currentPageIndex) {
      return;
    }

    commitActiveStroke();
    currentPageIndex = pageIndex;
    statusMessage = `Page ${pageIndex + 1}`;
  }

  function getPageStrokes(pageIndex: number): InkStroke[] {
    return strokes.filter((stroke) => stroke.pageIndex === pageIndex);
  }

  function setTool(tool: InkTool): void {
    commitActiveStroke();
    activeTool = tool;
  }

  function zoomOut(): void {
    zoom = Math.max(MIN_ZOOM, zoom - ZOOM_STEP);
  }

  function zoomIn(): void {
    zoom = Math.min(MAX_ZOOM, zoom + ZOOM_STEP);
  }

  function toggleTheme(): void {
    theme = theme === "dark" ? "light" : "dark";
  }

  function selectColor(color: string): void {
    brushColor = normalizeHexColor(color, brushColor);
  }

  function openCustomColorModal(): void {
    draftCustomColor = customColor;
    isColorModalOpen = true;
  }

  function applyCustomColor(): void {
    const normalized = normalizeHexColor(draftCustomColor, customColor);
    customColor = normalized;
    brushColor = normalized;
    isColorModalOpen = false;
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && isColorModalOpen) {
      event.preventDefault();
      isColorModalOpen = false;
      return;
    }

    const modifier = event.ctrlKey || event.metaKey;

    if (!modifier) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      redo();
    } else if (key === "=" || key === "+") {
      event.preventDefault();
      zoomIn();
    } else if (key === "-") {
      event.preventDefault();
      zoomOut();
    }
  }

  function reportError(error: unknown, fallback: string): void {
    const detail = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
    errorMessage = detail || fallback;
    statusMessage = fallback;
  }

  function downloadPdf(bytes: Uint8Array, name: string): void {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name || "document-inked.pdf";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function capturePointer(pointerId: number): void {
    try {
      inkCanvas?.setPointerCapture(pointerId);
    } catch {
      // Some browser previews do not support capture for every pointer type.
    }
  }

  function releasePointer(pointerId: number): void {
    try {
      inkCanvas?.releasePointerCapture(pointerId);
    } catch {
      // Capture may already be released after a pointer cancellation.
    }
  }

  function createId(): string {
    return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
</script>

<svelte:head>
  <meta name="description" content="CursivePDF is a tablet-friendly PDF handwriting layer app." />
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

<main class="app-shell" data-theme={theme}>
  <header class="topbar">
    <div class="brand">
      <img src="/logo.svg" class="logo" alt="" />
      <div>
        <strong>CursivePDF</strong>
        <span>{fileName || "No PDF open"}</span>
      </div>
    </div>

    <div class="toolbar" aria-label="Editing tools">
      <button type="button" class:active={activeTool === "draw"} aria-pressed={activeTool === "draw"} onclick={() => setTool("draw")}>
        Draw
      </button>
      <button type="button" class:active={activeTool === "erase"} aria-pressed={activeTool === "erase"} onclick={() => setTool("erase")}>
        Erase
      </button>
      <button type="button" disabled={!canUndo} onclick={undo}>Undo</button>
      <button type="button" disabled={!canRedo} onclick={redo}>Redo</button>
    </div>

    <nav class="actions" aria-label="Document actions">
      <button
        type="button"
        class="theme-toggle"
        aria-pressed={theme === "dark"}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        onclick={toggleTheme}
      >
        {themeToggleLabel}
      </button>
      <button type="button" disabled={isLoading || isExporting} onclick={handleOpenPdf}>Open PDF</button>
      <button type="button" class="primary" disabled={!canExport || isExporting} onclick={handleExportPdf}>
        {isExporting ? "Exporting" : "Export"}
      </button>
    </nav>

    <input
      bind:this={browserFileInput}
      class="file-input"
      type="file"
      accept="application/pdf,.pdf"
      onchange={handleBrowserFileSelected}
    />
  </header>

  <section class="workspace" aria-label="PDF editor workspace">
    <aside class="sidebar" aria-label="Pages">
      <div class="panel-title">Pages</div>

      {#if pdfDocument && pageIndexes.length}
        <div class="page-list">
          {#each pageIndexes as pageIndex}
            <PageThumbnail
              {pdfDocument}
              {pageIndex}
              active={pageIndex === currentPageIndex}
              strokes={getPageStrokes(pageIndex)}
              onselect={() => setPage(pageIndex)}
            />
          {/each}
        </div>
      {:else}
        <div class="empty-panel">No pages</div>
      {/if}
    </aside>

    <section class="document-stage" aria-label="Document canvas">
      <div class="stage-status">
        <span>{pageLabel}</span>
        {#if fileSize}
          <span>{formatFileSize(fileSize)}</span>
        {/if}
        <span>{statusMessage}</span>
      </div>

      <div class="page-shell">
        <div class="page-surface" class:empty={!pdfDocument} style={pageStyle}>
          {#if pdfDocument}
            <canvas bind:this={pdfCanvas} class="pdf-layer" aria-hidden="true"></canvas>
            <canvas
              bind:this={inkCanvas}
              class="ink-layer"
              aria-label="Handwriting layer"
              onpointerdown={handlePointerDown}
              onpointermove={handlePointerMove}
              onpointerup={handlePointerUp}
              onpointercancel={handlePointerCancel}
            ></canvas>
            {#if isRendering}
              <div class="rendering-badge">Rendering</div>
            {/if}
          {:else}
            <div class="empty-document">
              <img src="/logo.svg" alt="" />
              <strong>Open a PDF</strong>
              <span>Your handwriting layer will stay above the document.</span>
            </div>
          {/if}
        </div>
      </div>

      {#if errorMessage}
        <div class="error-banner" role="alert">{errorMessage}</div>
      {/if}
    </section>

    <aside class="inspector" aria-label="Ink settings">
      <section>
        <div class="panel-title">Deep Ink</div>
        <div class="swatches" aria-label="Ink color">
          {#each PEN_COLORS as color}
            <button
              type="button"
              class="swatch"
              class:active={brushColor === color}
              style={`--swatch: ${color}`}
              aria-label={`Use ${color} ink`}
              onclick={() => selectColor(color)}
            ></button>
          {/each}
        </div>
      </section>

      <section>
        <div class="panel-title">Custom Color</div>
        <div class="custom-color">
          <button
            type="button"
            class="swatch custom-swatch"
            class:active={brushColor === customColor}
            style={`--swatch: ${customColor}`}
            aria-label="Use custom ink color"
            onclick={() => selectColor(customColor)}
          ></button>
          <button type="button" onclick={openCustomColorModal}>Edit</button>
        </div>
      </section>

      <label>
        Stroke
        <input type="range" min="1" max="28" bind:value={brushSize} />
        <span>{brushSize}px</span>
      </label>

      <label>
        Opacity
        <input type="range" min="10" max="100" bind:value={inkOpacity} />
        <span>{inkOpacity}%</span>
      </label>

      <label>
        Smoothing
        <input type="range" min="0" max="100" bind:value={smoothing} />
        <span>{smoothing}</span>
      </label>

      <section>
        <div class="panel-title">View</div>
        <div class="zoom-controls">
          <button type="button" disabled={zoom <= MIN_ZOOM} onclick={zoomOut}>-</button>
          <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} bind:value={zoom} />
          <button type="button" disabled={zoom >= MAX_ZOOM} onclick={zoomIn}>+</button>
        </div>
        <div class="zoom-readout">{zoom}%</div>
      </section>

      <section>
        <div class="panel-title">Document</div>
        <dl class="stats">
          <div>
            <dt>Pages</dt>
            <dd>{pageCount || "-"}</dd>
          </div>
          <div>
            <dt>Ink strokes</dt>
            <dd>{strokes.length}</dd>
          </div>
          <div>
            <dt>This page</dt>
            <dd>{currentPageStrokes.length}</dd>
          </div>
        </dl>
      </section>

      <button type="button" class="danger" disabled={!currentPageStrokes.length} onclick={clearCurrentPage}>
        Clear Page Ink
      </button>
    </aside>
  </section>

  {#if isColorModalOpen}
    <div class="modal-backdrop">
      <div class="color-modal" role="dialog" aria-modal="true" aria-labelledby="custom-color-title">
        <header>
          <h2 id="custom-color-title">Custom Color</h2>
          <button type="button" aria-label="Close custom color picker" onclick={() => (isColorModalOpen = false)}>
            Close
          </button>
        </header>

        <div class="color-picker">
          <input type="color" bind:value={draftCustomColor} aria-label="Custom ink color" />
          <div class="color-preview" style={`--swatch: ${draftCustomColor}`}></div>
          <code>{draftCustomColor}</code>
        </div>

        <footer>
          <button type="button" onclick={() => (isColorModalOpen = false)}>Cancel</button>
          <button type="button" class="primary" onclick={applyCustomColor}>Use Color</button>
        </footer>
      </div>
    </div>
  {/if}
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
    font-size: 16px;
    line-height: 1.5;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  button,
  input {
    font: inherit;
  }

  button {
    min-height: 34px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    color: var(--text);
    background: var(--button-bg);
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--button-hover);
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .app-shell {
    --accent: #2563eb;
    --accent-strong: #1d4ed8;
    --accent-soft: rgba(37, 99, 235, 0.2);
    --app-bg: #edf1f5;
    --border: #d3dbe3;
    --border-strong: #b7c3cf;
    --button-bg: #ffffff;
    --button-hover: #f7fafc;
    --danger-bg: #fff7f7;
    --danger-border: #fecaca;
    --danger-text: #991b1b;
    --grid-color: rgba(23, 33, 43, 0.045);
    --muted: #65717d;
    --panel: #f8fafb;
    --paper-shadow: rgba(23, 33, 43, 0.16);
    --stage: #e2e8ee;
    --status-bg: rgba(248, 250, 252, 0.88);
    --success: #047857;
    --surface: #fbfcfd;
    --text: #17212b;
    --text-strong: #101828;
    --warning-bg: #dcecff;
    --warning-text: #16437e;

    display: grid;
    grid-template-rows: 58px minmax(0, 1fr);
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    color: var(--text);
    background: var(--app-bg);
  }

  .app-shell[data-theme="dark"] {
    --accent: #69a7ff;
    --accent-strong: #93c5fd;
    --accent-soft: rgba(105, 167, 255, 0.24);
    --app-bg: #111315;
    --border: #2d333a;
    --border-strong: #414a53;
    --button-bg: #1b1f23;
    --button-hover: #242a30;
    --danger-bg: #2b1518;
    --danger-border: #7f1d1d;
    --danger-text: #fecaca;
    --grid-color: rgba(236, 240, 244, 0.055);
    --muted: #a7b0ba;
    --panel: #171a1e;
    --paper-shadow: rgba(0, 0, 0, 0.5);
    --stage: #121619;
    --status-bg: rgba(23, 26, 30, 0.9);
    --surface: #181c20;
    --text: #e8edf2;
    --text-strong: #ffffff;
    --warning-bg: #17304f;
    --warning-text: #cfe3ff;
  }

  .topbar {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) auto minmax(270px, 1fr);
    align-items: center;
    gap: 14px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .logo {
    width: 34px;
    height: 34px;
    flex: 0 0 auto;
    border-radius: 9px;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.18);
  }

  .brand div {
    display: grid;
    min-width: 0;
  }

  .brand strong,
  .brand span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .brand strong {
    color: var(--text-strong);
  }

  .brand span {
    color: var(--muted);
    font-size: 0.78rem;
  }

  .toolbar,
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toolbar {
    justify-content: center;
  }

  .actions {
    justify-content: flex-end;
  }

  .toolbar button,
  .actions button {
    padding: 0 13px;
  }

  .toolbar button.active,
  .primary {
    border-color: var(--accent);
    color: #ffffff;
    background: var(--accent);
  }

  .toolbar button.active:hover,
  .primary:hover:not(:disabled) {
    border-color: var(--accent-strong);
    background: var(--accent-strong);
  }

  .theme-toggle {
    min-width: 68px;
  }

  .file-input {
    display: none;
  }

  .workspace {
    display: grid;
    grid-template-columns: 138px minmax(0, 1fr) 258px;
    min-height: 0;
  }

  .sidebar,
  .inspector {
    min-height: 0;
    border-color: var(--border);
    background: var(--panel);
  }

  .sidebar {
    overflow-y: auto;
    padding: 14px;
    border-right: 1px solid var(--border);
  }

  .inspector {
    display: flex;
    flex-direction: column;
    gap: 20px;
    overflow-y: auto;
    padding: 16px;
    border-left: 1px solid var(--border);
  }

  .panel-title {
    margin-bottom: 10px;
    color: var(--muted);
    font-size: 0.74rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .page-list {
    display: grid;
    justify-content: center;
    gap: 10px;
  }

  .empty-panel {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .document-stage {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background:
      linear-gradient(90deg, var(--grid-color) 1px, transparent 1px),
      linear-gradient(var(--grid-color) 1px, transparent 1px),
      var(--stage);
    background-size: 32px 32px;
  }

  .stage-status {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 34px;
    overflow: hidden;
    padding: 7px 18px;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
    background: var(--status-bg);
    font-size: 0.84rem;
  }

  .stage-status span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .page-shell {
    min-height: 0;
    overflow: auto;
    padding: 34px;
  }

  .page-surface {
    position: relative;
    width: min(100%, 720px);
    min-width: 320px;
    aspect-ratio: 8.5 / 11;
    margin: 0 auto;
    border: 1px solid var(--border-strong);
    background: #ffffff;
    box-shadow: 0 20px 48px var(--paper-shadow);
  }

  .page-surface.empty {
    width: min(100%, 620px);
    min-width: min(100%, 320px);
    min-height: 360px;
    aspect-ratio: auto;
    background: var(--button-bg);
  }

  .page-surface:not(.empty) {
    aspect-ratio: auto;
  }

  .pdf-layer,
  .ink-layer {
    position: absolute;
    inset: 0;
    display: block;
  }

  .pdf-layer {
    z-index: 1;
  }

  .ink-layer {
    z-index: 3;
    touch-action: none;
    cursor: crosshair;
  }

  .empty-document {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 8px;
    color: var(--muted);
    text-align: center;
  }

  .empty-document img {
    width: 76px;
    height: 76px;
    margin-bottom: 8px;
    border-radius: 18px;
    box-shadow: 0 14px 30px rgba(15, 23, 42, 0.2);
  }

  .empty-document strong {
    color: var(--text-strong);
    font-size: 1.2rem;
  }

  .rendering-badge,
  .error-banner {
    border-radius: 6px;
    font-size: 0.84rem;
    font-weight: 800;
  }

  .rendering-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 4;
    padding: 6px 9px;
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .error-banner {
    margin: 0 18px 16px;
    padding: 10px 12px;
    color: var(--danger-text);
    background: var(--danger-bg);
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .swatch {
    min-height: 34px;
    border-color: var(--border-strong);
    background: var(--swatch);
  }

  .swatch.active {
    border-color: var(--text-strong);
    box-shadow:
      0 0 0 2px var(--button-bg) inset,
      0 0 0 1px var(--text-strong);
  }

  .custom-color {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }

  .custom-swatch {
    width: 100%;
  }

  label {
    display: grid;
    gap: 8px;
    color: var(--muted);
    font-size: 0.9rem;
    font-weight: 800;
  }

  label span {
    color: var(--text);
    font-size: 0.84rem;
  }

  input[type="range"] {
    width: 100%;
    accent-color: var(--accent);
  }

  .zoom-controls {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) 34px;
    align-items: center;
    gap: 8px;
  }

  .zoom-readout {
    margin-top: 8px;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--button-bg);
    text-align: center;
    font-weight: 800;
  }

  .stats {
    display: grid;
    gap: 8px;
    margin: 0;
  }

  .stats div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .stats dt {
    color: var(--muted);
    font-size: 0.86rem;
  }

  .stats dd {
    margin: 0;
    font-weight: 800;
  }

  .danger {
    border-color: var(--danger-border);
    color: var(--danger-text);
    background: var(--danger-bg);
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(9, 13, 18, 0.55);
  }

  .color-modal {
    display: grid;
    gap: 20px;
    width: min(100%, 360px);
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    background: var(--surface);
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
  }

  .color-modal header,
  .color-modal footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .color-modal h2 {
    margin: 0;
    color: var(--text-strong);
    font-size: 1.05rem;
  }

  .color-picker {
    display: grid;
    grid-template-columns: 76px 1fr;
    align-items: center;
    gap: 14px;
  }

  .color-picker input[type="color"] {
    width: 76px;
    height: 76px;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: transparent;
  }

  .color-preview {
    min-height: 76px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background:
      linear-gradient(135deg, transparent 48%, rgba(255, 255, 255, 0.35) 49%, transparent 52%),
      var(--swatch);
  }

  .color-picker code {
    grid-column: 1 / -1;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted);
    background: var(--button-bg);
  }

  @media (max-width: 1020px) {
    .topbar {
      grid-template-columns: 1fr auto;
    }

    .toolbar {
      order: 3;
      grid-column: 1 / -1;
      justify-content: flex-start;
      padding-bottom: 8px;
    }

    .app-shell {
      grid-template-rows: auto minmax(0, 1fr);
    }

    .workspace {
      grid-template-columns: 130px minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
    }

    .inspector {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-items: start;
      overflow-y: auto;
      max-height: 34vh;
      padding: 12px 14px;
      border-top: 1px solid var(--border);
      border-left: 0;
      gap: 14px;
    }

    .inspector .danger {
      align-self: end;
    }
  }

  @media (max-width: 680px) {
    .topbar {
      grid-template-columns: 1fr;
      align-items: stretch;
      padding: 10px;
    }

    .toolbar,
    .actions {
      justify-content: stretch;
    }

    .toolbar button,
    .actions button {
      flex: 1;
      padding: 0 8px;
    }

    .workspace {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(0, 1fr) auto;
    }

    .sidebar {
      display: none;
    }

    .page-shell {
      padding: 18px;
    }

    .page-surface {
      min-width: min(100%, 320px);
    }

    .stage-status {
      padding: 7px 10px;
    }

    .inspector {
      grid-template-columns: 1fr;
      max-height: 42vh;
    }
  }
</style>
