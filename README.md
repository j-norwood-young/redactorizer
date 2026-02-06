# Redactorizer

A desktop app for redacting sensitive areas in images. Draw shapes over the parts you want to hide, apply pixelation, blur, or solid fill, then save, copy, or share the result.

## Features

- **Open any image** — Load PNG (or other image formats via the system dialog) to redact.
- **Shape tools** — Rectangle, square, circle, or freehand to mark regions to redact.
- **Redaction effects** — Pixelate, blur, or solid fill. Adjust pixel size, blur radius, and fill color per effect.
- **Edit after drawing** — Select shapes to move or resize with handles; change effect or delete (Backspace/Delete).
- **Export** — Save to file (⌘S), copy to clipboard, or share via the system share sheet.

## Tech stack

- **Tauri 2** — Desktop shell; Rust backend in `src-tauri/`.
- **Svelte 5** (Runes) + **TypeScript** — Frontend in `src/`.
- **Vite** — Build and dev server.

## Getting started

```bash
pnpm install
pnpm tauri dev
```

## Recommended IDE setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).
