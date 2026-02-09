#!/usr/bin/env bash
# Build and upload Redactorizer to the Mac App Store.
# See https://v2.tauri.app/distribute/app-store/
#
# Required env vars:
#   APPLE_API_KEY_ID     - App Store Connect API Key ID
#   APPLE_API_ISSUER     - App Store Connect Issuer ID
#   INSTALLER_SIGNING_ID  - Mac Installer Distribution cert for App Store (e.g. "3rd Party Mac Developer Installer: Your Name (TEAM_ID)")
#
# Private key: save as AuthKey_<APPLE_API_KEY_ID>.p8 in ~/private_keys, ~/.private_keys, or ~/.appstoreconnect/private_keys

set -euo pipefail

APP_NAME="Redactorizer"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="$REPO_ROOT/src-tauri/target"
# Apple Silicon only (no universal); bundle lives at target/release/bundle/macos/
APP_BUNDLE="$TARGET_DIR/release/bundle/macos/$APP_NAME.app"
PKG_PATH="$REPO_ROOT/$APP_NAME.pkg"

BUILD_ONLY=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --build-only)
      BUILD_ONLY=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--build-only]"
      exit 1
      ;;
  esac
done

cd "$REPO_ROOT"

# Copy provisioning profile to src-tauri/keys so bundle step finds it (paths in tauri.conf are relative to config dir)
PROVISION_SRC="$REPO_ROOT/keys/Redactorizer_MacOS_Profile.provisionprofile"
PROVISION_DEST_DIR="$REPO_ROOT/src-tauri/keys"
if [[ ! -f "$PROVISION_SRC" ]]; then
  echo "Error: Provisioning profile not found at $PROVISION_SRC"
  exit 1
fi
mkdir -p "$PROVISION_DEST_DIR"
cp "$PROVISION_SRC" "$PROVISION_DEST_DIR/Redactorizer_MacOS_Profile.provisionprofile"
echo "==> Provisioning profile ready for bundle"

# Validate env when uploading
if [[ "$BUILD_ONLY" == false ]]; then
  if [[ -z "${APPLE_API_KEY_ID:-}" ]] || [[ -z "${APPLE_API_ISSUER:-}" ]]; then
    echo "Error: APPLE_API_KEY_ID and APPLE_API_ISSUER must be set for upload."
    echo "Create an API key in App Store Connect > Users and Access > Integrations > Individual Keys."
    exit 1
  fi
  if [[ -z "${INSTALLER_SIGNING_ID:-}" ]]; then
    echo "Error: INSTALLER_SIGNING_ID must be set (Mac Installer Distribution certificate)."
    echo "Example: INSTALLER_SIGNING_ID='3rd Party Mac Developer Installer: Your Name (97N553B523)'"
    exit 1
  fi
fi

echo "==> Building and bundling macOS app (Apple Silicon only)..."
# Do not notarize for App Store: Apple validates on upload. Notarization is for Developer ID only.
# Unset notarization env vars so Tauri skips notarization (avoids "Developer ID certificate" / "secure timestamp" errors).
(
  unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
  unset APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER APPLE_API_KEY_PATH
  pnpm tauri build --bundles app --config src-tauri/tauri.appstore.conf.json
)

if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "Error: App bundle not found at $APP_BUNDLE"
  exit 1
fi

if [[ "$BUILD_ONLY" == true ]]; then
  echo "==> Build complete. App: $APP_BUNDLE"
  echo "    Sign and upload manually:"
  echo "    xcrun productbuild --sign \"\$INSTALLER_SIGNING_ID\" --component \"$APP_BUNDLE\" /Applications \"$APP_NAME.pkg\""
  echo "    xcrun altool --upload-app --type macos --file \"$APP_NAME.pkg\" --apiKey \$APPLE_API_KEY_ID --apiIssuer \$APPLE_API_ISSUER"
  exit 0
fi

echo "==> Creating signed .pkg..."
xcrun productbuild --sign "$INSTALLER_SIGNING_ID" --component "$APP_BUNDLE" /Applications "$PKG_PATH"

# altool looks for AuthKey_<ID>.p8 in private_keys (or ~/private_keys, ~/.private_keys, ~/.appstoreconnect/private_keys)
# If the key lives in keys/, symlink it so altool finds it when run from repo root
PRIVATE_KEYS_DIR="$REPO_ROOT/private_keys"
KEY_FILE="AuthKey_${APPLE_API_KEY_ID}.p8"
if [[ ! -f "$PRIVATE_KEYS_DIR/$KEY_FILE" ]] && [[ -f "$REPO_ROOT/keys/$KEY_FILE" ]]; then
  mkdir -p "$PRIVATE_KEYS_DIR"
  ln -sf "$REPO_ROOT/keys/$KEY_FILE" "$PRIVATE_KEYS_DIR/$KEY_FILE"
fi

echo "==> Uploading to App Store Connect..."
xcrun altool --upload-app --type macos --file "$PKG_PATH" --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"

echo "==> Done. App submitted for validation; it will appear in TestFlight when approved."
echo "    You can remove the local .pkg: rm -f $PKG_PATH"
