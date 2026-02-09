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

## Distributing (Mac App Store, Apple Silicon only)

To build and upload to the Mac App Store (run from repo root). The app targets **Apple Silicon only** (no Intel).

```bash
# Build only (no sign/upload)
pnpm run appstore:mac:build

# Build, sign .pkg, and upload (requires env vars)
APPLE_API_KEY_ID=... APPLE_API_ISSUER=... INSTALLER_SIGNING_ID='3rd Party Mac Developer Installer: ...' pnpm run appstore:mac
```

Set `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` from [App Store Connect → Users and Access → Integrations → Individual Keys](https://appstoreconnect.apple.com/access/users). Put the private key as `AuthKey_<KEY_ID>.p8` in `keys/` (the script will link it for altool). Use a **Mac Installer Distribution** (3rd Party Mac Developer Installer) certificate for `INSTALLER_SIGNING_ID`.

**Certificate and provisioning profile (required for upload):** The .app must be signed with the same certificate that is in your Mac App Store provisioning profile.

1. **Create the App Store application certificate** (if you don’t have it): [Apple Developer → Certificates](https://developer.apple.com/account/resources/certificates/list) → **+** → under **Mac App Store** choose **Mac App Distribution** (or “Mac App Store” / “3rd Party Mac Developer Application”). Create a CSR in Keychain Access if prompted, upload it, download the certificate and double‑click to install.
2. **Attach that certificate to your provisioning profile:** [Profiles](https://developer.apple.com/account/resources/profiles/list) → open your **Redactorizer** Mac App Store profile (or create one: type **Mac App Store Connect**, choose your App ID, then **select the Mac App Distribution certificate** you created). If editing, click **Edit** → under **Certificates** ensure the **Mac App Distribution** (3rd Party Mac Developer Application) cert is selected → **Save** → **Download** and replace `keys/Redactorizer_MacOS_Profile.provisionprofile`.
3. **Use that identity for the App Store build:** In `src-tauri/tauri.appstore.conf.json`, `signingIdentity` must be the **exact** name of that certificate. Run `security find-identity -v -p codesigning` and copy the **“3rd Party Mac Developer Application: …”** line into `tauri.appstore.conf.json` if it differs from the placeholder.

## License

Redactorizer is free software: you can redistribute it and/or modify it under the terms of the **GNU General Public License v3** (or later). See [LICENSE.md](LICENSE.md) for the full text.

## Recommended IDE setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).
