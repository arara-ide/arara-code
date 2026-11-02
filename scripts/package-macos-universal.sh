#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cd "$1" && pwd)"
mkdir -p "$2"
OUTPUT="$(cd "$2" && pwd)"
VERSION="$3"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
WORK="$(mktemp -d "${TMPDIR:-/tmp}/arara-universal.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/vscode"
tar -xzf "$INPUT/macos-merge-tools.tar.gz" -C "$WORK/vscode"
for arch in x64 arm64; do
  mkdir -p "$WORK/VSCode-darwin-$arch"
  ditto -x -k "$INPUT/AraraCode-darwin-$arch-$VERSION.zip" "$WORK/VSCode-darwin-$arch"
done
npm ci --prefix "$WORK/vscode/build" --ignore-scripts --no-audit --no-fund
export VSCODE_ARCH=universal
node "$WORK/vscode/build/darwin/create-universal-app.ts" "$WORK"
for APP in "$WORK/VSCode-darwin-universal/"*.app; do break; done
test -d "$APP"
APP_PATH="$APP" node "$WORK/vscode/build/darwin/verify-macho.ts" universal
codesign --force --deep --sign - "$APP"
codesign --verify --strict --deep "$APP"
mkdir -p "$WORK/stage"
ditto "$APP" "$WORK/stage/Arara Code.app"
ln -s /Applications "$WORK/stage/Applications"
DMG="$OUTPUT/AraraCode-darwin-universal-$VERSION.dmg"
test ! -e "$DMG"
hdiutil makehybrid -hfs -hfs-volume-name "Arara Code" -hfs-openfolder "$WORK/stage" -o "$WORK/raw.dmg" "$WORK/stage"
hdiutil convert "$WORK/raw.dmg" -format UDZO -imagekey zlib-level=9 -o "$DMG"
hdiutil verify "$DMG"
