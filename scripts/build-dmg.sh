#!/usr/bin/env bash
# Builds dist/Phone-Explorer-<version>-arm64.dmg: the app plus an Applications shortcut to drag it onto.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

VERSION="$(node -p "require('./package.json').version")"
APP="dist/Phone Explorer.app"
DMG="dist/Phone-Explorer-${VERSION}-arm64.dmg"

bash scripts/build-app.sh

# The app is not notarized. Ad-hoc sign the whole bundle so macOS reports "unverified developer"
# (which the user can allow) instead of "app is damaged".
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create -volname "Phone Explorer" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
hdiutil verify "$DMG" >/dev/null

echo "Built $DMG ($(du -h "$DMG" | cut -f1))"
shasum -a 256 "$DMG"
