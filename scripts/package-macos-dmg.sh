#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cd "$1" && pwd)"
mkdir -p "$2"
OUTPUT="$(cd "$2" && pwd)"
VERSION="$3"
ARCH="$4"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
case "$ARCH" in x64) CPU=x86_64 ;; arm64) CPU=arm64 ;; *) exit 1 ;; esac
WORK="$(mktemp -d "${TMPDIR:-/tmp}/arara-dmg.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/app" "$WORK/stage"
ditto -x -k "$INPUT/AraraCode-darwin-$ARCH-$VERSION.zip" "$WORK/app"
for APP in "$WORK/app/"*.app; do break; done
test -d "$APP"
EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"
lipo "$APP/Contents/MacOS/$EXECUTABLE" -verify_arch "$CPU"
codesign --verify --strict --deep "$APP"
ditto "$APP" "$WORK/stage/Arara Code.app"
ln -s /Applications "$WORK/stage/Applications"
DMG="$OUTPUT/AraraCode-darwin-$ARCH-$VERSION.dmg"
test ! -e "$DMG"
hdiutil create -srcfolder "$WORK/stage" -volname "Arara Code" -fs HFS+ -format UDZO -imagekey zlib-level=9 "$DMG"
hdiutil verify "$DMG"
