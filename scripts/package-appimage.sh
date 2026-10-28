#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$(cd "$1" && pwd)"
mkdir -p "$2"
OUTPUT="$(cd "$2" && pwd)"
case "$3" in
  x64) ARCH="x86_64" ;;
  arm64) ARCH="aarch64" ;;
  *) echo "Unsupported AppImage architecture: $3" >&2; exit 1 ;;
esac
VERSION="$4"
[[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid release version" >&2; exit 1; }
STAGING="$(mktemp -d)"
trap 'rm -rf "${STAGING}"' EXIT
APPDIR="${STAGING}/AraraCode.AppDir"
mkdir -p "${APPDIR}/usr/share/arara-code"
cp -a "${SOURCE}/." "${APPDIR}/usr/share/arara-code/"
PRODUCT="${APPDIR}/usr/share/arara-code/resources/app/product.json"
jq '. + {araraInstallFormat: "appimage"}' "${PRODUCT}" > "${PRODUCT}.tmp"
mv "${PRODUCT}.tmp" "${PRODUCT}"
install -m 755 "${ROOT}/branding/linux/AppRun" "${APPDIR}/AppRun"
cp "${SOURCE}/resources/app/resources/linux/code.png" "${APPDIR}/arara-code.png"
ln -s arara-code.png "${APPDIR}/.DirIcon"
cat > "${APPDIR}/arara-code.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Arara Code
Exec=arara-code %F
Icon=arara-code
Terminal=false
Categories=Development;IDE;TextEditor;
StartupWMClass=Arara Code
DESKTOP

for TOOL in appimagetool runtime; do
  URL="$(jq -r --arg tool "${TOOL}" --arg arch "${ARCH}" '.[$tool].url | gsub("ARCH"; $arch)' "${ROOT}/scripts/appimage-tools.json")"
  SHA256="$(jq -r --arg tool "${TOOL}" --arg arch "${ARCH}" '.[$tool].sha256[$arch]' "${ROOT}/scripts/appimage-tools.json")"
  curl -fsSL --retry 6 --retry-delay 15 --retry-all-errors "${URL}" -o "${STAGING}/${TOOL}"
  printf '%s  %s\n' "${SHA256}" "${STAGING}/${TOOL}" | sha256sum -c -
done
chmod 755 "${STAGING}/appimagetool"
ARCH="${ARCH}" APPIMAGE_EXTRACT_AND_RUN=1 "${STAGING}/appimagetool" \
  --runtime-file "${STAGING}/runtime" "${APPDIR}" "${OUTPUT}/AraraCode-linux-$3-${VERSION}.AppImage"
