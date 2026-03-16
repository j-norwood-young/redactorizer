# Redactorizer

A desktop app for redacting sensitive areas in images and PDFs. Draw shapes over the parts you want to hide, apply pixelation, blur, or solid fill, then save, copy, or share the result.

**Website:** [redactorizer.com](https://redactorizer.com)

## Features

- **Open images and PDFs** — Load PNG, JPEG, GIF, WebP, BMP, or PDF via the system dialog or drag-and-drop.
- **Multi-page PDF support** — Open PDFs, switch between pages in the sidebar, and redact each page. Export the whole document as a single redacted PDF or as one PNG per page.
- **Shape tools** — Rectangle, ellipse, or freehand to mark regions to redact. Hold Option while drawing for equal width/height (square or circle).
- **Redaction effects** — Pixelate, blur, or solid fill. Adjust pixel size, blur radius, and fill color per effect.
- **Edit after drawing** — Select shapes to move or resize with handles; change effect or delete (Backspace/Delete).
- **Export** — Save to file (⌘S), copy to clipboard, or share via the system share sheet. Export PDFs as a single redacted PDF or as PNGs.

## Tech stack

- **Tauri 2** — Desktop shell; Rust backend in `src-tauri/`.
- **Svelte 5** (Runes) + **TypeScript** — Frontend in `src/`.
- **Vite** — Build and dev server.

## Getting started

```bash
pnpm install
pnpm tauri dev
```

## License

Redactorizer is free software: you can redistribute it and/or modify it under the terms of the **GNU General Public License v3** (or later). See [LICENSE.md](LICENSE.md) for the full text.
