# CursivePDF

CursivePDF is a cross-platform desktop app for adding a handwriting layer on top of PDF documents. The project is set up with SvelteKit, TypeScript, Vite, and Tauri v2.

## Goal

The editor will render the source PDF underneath a separate ink layer. Tablet, pen, touch, and mouse input will be captured into page-relative stroke data so handwriting stays aligned while zooming, scrolling, rotating, saving, and exporting.

On export, the ink layer should be written after the original page content so it appears above all existing PDF elements.

## Current MVP

- Open PDF files with the native Tauri dialog
- Render PDF pages with PDF.js
- Preview pages as thumbnails in the side panel
- Draw an always-on-top ink layer with pen, touch, or mouse input
- Preserve pressure data from pointer events when available
- Tune pen smoothing, stroke width, opacity, zoom, and ink color
- Pick from deep pen-ink colors or define one custom color slot
- Toggle light/dark mode
- Save user settings locally between sessions
- Use generated Tauri app icons from the red folded-document CursivePDF logo
- Switch pages while keeping page-specific ink
- Undo, redo, erase whole strokes, and clear a page's ink
- Export a new PDF with ink appended above the original page content
- Use a browser fallback for quick Vite testing outside Tauri

## Tech Stack

- SvelteKit and TypeScript for the app UI
- Tauri v2 for the native desktop shell and packaging
- PDF.js via `pdfjs-dist` for PDF rendering
- `pdf-lib` for writing/exporting annotated PDFs
- Tauri dialog and filesystem plugins for native open/save workflows

## Prerequisites

- Node.js
- pnpm
- Rust and Cargo
- Tauri OS prerequisites for your platform

Tauri's current prerequisite guide is here: https://tauri.app/start/prerequisites/

## Development

Install dependencies:

```sh
pnpm install
```

Run the Svelte development server:

```sh
pnpm dev
```

Run the desktop app:

```sh
pnpm tauri dev
```

Check TypeScript and Svelte diagnostics:

```sh
pnpm check
```

Build the frontend:

```sh
pnpm build
```

Build a desktop bundle:

```sh
pnpm tauri build
```

Successful Windows builds are written under:

```sh
src-tauri/target/release/
src-tauri/target/release/bundle/
```

## Planned Project Shape

- `src/routes/+page.svelte` - editor UI and interaction wiring
- `src/lib/files` - open/save helpers and browser fallback utilities
- `src/lib/pdf` - PDF loading, rendering, viewport transforms
- `src/lib/ink` - stroke model, hit testing, canvas rendering, PDF export
- `src/lib/settings` - persisted local user preferences
- `src-tauri` - Tauri v2 Rust shell and plugin setup

## License

MIT
