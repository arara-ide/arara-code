#!/usr/bin/env bash
set -euo pipefail

DMG="$1"
WORK="$(mktemp -d "/tmp/arara-dmg-test.XXXXXX")"
MOUNT="$WORK/mount"
APP_PID=""
cleanup() {
  if [[ -n "$APP_PID" ]]; then kill "$APP_PID" 2>/dev/null || true; wait "$APP_PID" 2>/dev/null || true; fi
  if mount | grep -Fq " on $MOUNT "; then hdiutil detach "$MOUNT"; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
hdiutil verify "$DMG"
mkdir -p "$MOUNT"
hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT" "$DMG"
test "$(readlink "$MOUNT/Applications")" = /Applications
ditto "$MOUNT/Arara Code.app" "$WORK/Arara Code.app"
hdiutil detach "$MOUNT"
APP="$WORK/Arara Code.app"
codesign --verify --strict --deep "$APP"
EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"
lipo "$APP/Contents/MacOS/$EXECUTABLE" -verify_arch x86_64 arm64
lipo "$APP/Contents/Resources/app/node_modules.asar.unpacked/kerberos/build/Release/kerberos.node" -verify_arch x86_64 arm64
for extension in arara-ai arara-bot arara-orchestra arara-update; do
  test -s "$APP/Contents/Resources/app/extensions/$extension/package.json"
done
ISOLATED_ARGS=(--user-data-dir "$WORK/profile" --extensions-dir "$WORK/extensions" --shared-data-dir "$WORK/shared" --agent-plugins-dir "$WORK/plugins" --agents-user-data-dir "$WORK/agents-profile" --agents-extensions-dir "$WORK/agents-extensions")
"$APP/Contents/Resources/app/bin/arara-code" --version "${ISOLATED_ARGS[@]}"
env -u ELECTRON_RUN_AS_NODE "$APP/Contents/MacOS/$EXECUTABLE" "${ISOLATED_ARGS[@]}" --prof-append-timers "$WORK/startup.txt" --disable-telemetry --skip-welcome --skip-release-notes --disable-updates > "$WORK/startup.log" 2>&1 &
APP_PID=$!
for attempt in {1..90}; do
  if [[ -s "$WORK/startup.txt" ]]; then
    echo "PASS: universal DMG mounted, installed and started on $(uname -m)"
    exit 0
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then break; fi
  sleep 1
done
cat "$WORK/startup.log"
echo "FAIL: installed universal app did not report startup" >&2
exit 1
