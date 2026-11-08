#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${ARARA_MACOS_SIGN_P12_BASE64:?Missing persistent signing certificate}"
: "${ARARA_MACOS_SIGN_PASSWORD:?Missing signing certificate password}"
: "${ARARA_MACOS_SIGN_IDENTITY:?Missing certificate fingerprint}"
: "${RUNNER_TEMP:?Missing isolated runner directory}"
[[ "$ARARA_MACOS_SIGN_IDENTITY" =~ ^[[:xdigit:]]{40}$ ]]
WORK="$(mktemp -d "$RUNNER_TEMP/arara-signing.XXXXXX")"
KEYCHAIN="$WORK/signing.keychain-db"
PASSWORD="$(openssl rand -hex 32)"
IMPORTED=0
cleanup() {
  rm -f "$WORK/signing.p12"
  if [[ "$IMPORTED" == 0 ]]; then security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
printf '%s' "$ARARA_MACOS_SIGN_P12_BASE64" | /usr/bin/base64 -D > "$WORK/signing.p12"
security create-keychain -p "$PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$PASSWORD" "$KEYCHAIN"
security import "$WORK/signing.p12" -k "$KEYCHAIN" -P "$ARARA_MACOS_SIGN_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PASSWORD" "$KEYCHAIN" >/dev/null
printf 'ARARA_MACOS_SIGN_KEYCHAIN=%s\n' "$KEYCHAIN" >> "$GITHUB_ENV"
IMPORTED=1
