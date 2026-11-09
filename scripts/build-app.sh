#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "Building Phone Explorer.app..."
npx @electron/packager . "Phone Explorer" \
  --platform=darwin \
  --arch=arm64 \
  --out=dist \
  --overwrite \
  --prune=true \
  --app-bundle-id="io.github.muditagarwal88.phone-explorer" \
  --app-category-type="public.app-category.utilities" \
  --ignore="^/dist$" \
  --ignore="^/test$" \
  --ignore="^/test-results$" \
  --ignore="^/docs$" \
  --ignore="^/scripts$" \
  --ignore="^/\\.github$" \
  --ignore="^/playwright\\.config\\.js$" \
  --ignore="^/\\.git$"

APP_PATH="dist/Phone Explorer-darwin-arm64/Phone Explorer.app"
FINAL_APP="dist/Phone Explorer.app"

if [ -d "$APP_PATH" ]; then
  rm -rf "$FINAL_APP"
  mv "$APP_PATH" "$FINAL_APP"
  rm -rf "dist/Phone Explorer-darwin-arm64"
  echo "Build successful: $FINAL_APP"
fi

if [[ "${1:-}" == "--install" ]]; then
  echo "Installing to ~/Applications..."
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/Phone Explorer.app"
  cp -R "$FINAL_APP" "$HOME/Applications/"
  echo "Installed to $HOME/Applications/Phone Explorer.app"
fi
