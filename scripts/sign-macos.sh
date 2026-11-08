#!/usr/bin/env bash
set -euo pipefail

APP="$1"
: "${ARARA_MACOS_SIGN_IDENTITY:?Missing persistent macOS signing identity}"
: "${ARARA_MACOS_SIGN_KEYCHAIN:?Missing isolated signing keychain}"
[[ "$ARARA_MACOS_SIGN_IDENTITY" =~ ^[[:xdigit:]]{40}$ ]]
test -d "$APP"
test -f "$ARARA_MACOS_SIGN_KEYCHAIN"
codesign --force --deep --sign "$ARARA_MACOS_SIGN_IDENTITY" --keychain "$ARARA_MACOS_SIGN_KEYCHAIN" --timestamp=none "$APP"
codesign --verify --strict --deep "$APP"
codesign --verify --strict -R "=certificate leaf = H\"$ARARA_MACOS_SIGN_IDENTITY\"" "$APP"
