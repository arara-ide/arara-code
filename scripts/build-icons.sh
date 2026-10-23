#!/usr/bin/env bash
# Gera os ícones do Arara Code a partir de branding/icons/*.svg, no layout
# que o VSCodium espera em src/stable/ (que o prepare_vscode.sh copia sobre vscode/).
#
# Uso: scripts/build-icons.sh <diretório-src-stable-de-destino>
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
DEST="${1:?uso: build-icons.sh <dest src/stable>}"
ICON="${ROOT}/branding/icons/arara.svg"
MONO="${ROOT}/branding/icons/arara-mono.svg"

for bin in rsvg-convert convert; do
  command -v "${bin}" >/dev/null || { echo "faltando: ${bin}" >&2; exit 1; }
done

TMP="$( mktemp -d )"
trap 'rm -rf "${TMP}"' EXIT

png() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; }

# --- linux
mkdir -p "${DEST}/resources/linux/rpm"
png "${ICON}" 512 "${DEST}/resources/linux/code.png"
cp "${ICON}" "${DEST}/resources/linux/code.svg"
convert "${DEST}/resources/linux/code.png" -resize 256x256 "${DEST}/resources/linux/rpm/code.xpm"

# --- server / web
mkdir -p "${DEST}/resources/server"
png "${ICON}" 192 "${DEST}/resources/server/code-192.png"
png "${ICON}" 512 "${DEST}/resources/server/code-512.png"

# --- windows (ícone principal e tiles; os .bmp do instalador ficam para o step de Windows)
mkdir -p "${DEST}/resources/win32"
png "${ICON}" 256 "${TMP}/256.png"
convert "${TMP}/256.png" -define icon:auto-resize=256,128,96,64,48,32,24,20,16 "${DEST}/resources/win32/code.ico"
cp "${DEST}/resources/win32/code.ico" "${DEST}/resources/server/favicon.ico"
png "${ICON}" 45 "${TMP}/45.png"
convert -size 70x70 canvas:transparent "${TMP}/45.png" -gravity center -composite PNG32:"${DEST}/resources/win32/code_70x70.png"
png "${ICON}" 64 "${TMP}/64.png"
convert -size 150x150 canvas:transparent "${TMP}/64.png" -gravity NorthWest -geometry +44+25 -composite PNG32:"${DEST}/resources/win32/code_150x150.png"

# --- macOS: .icns precisa de png2icns (npm i -g png2icns). Opcional no Linux.
if command -v png2icns >/dev/null; then
  mkdir -p "${DEST}/resources/darwin"
  for s in 1024 512 256 128; do png "${ICON}" "${s}" "${TMP}/m${s}.png"; done
  png2icns "${DEST}/resources/darwin/code.icns" "${TMP}"/m{1024,512,256,128}.png
else
  echo "aviso: png2icns ausente, mantendo code.icns do VSCodium (só afeta build macOS)" >&2
fi

# --- workbench: ícone da barra de título/about e marca d'água do editor vazio
mkdir -p "${DEST}/src/vs/workbench/browser/media" "${DEST}/src/vs/workbench/browser/parts/editor/media"
cp "${ICON}" "${DEST}/src/vs/workbench/browser/media/code-icon.svg"

letterpress() { # $1 arquivo, $2 cor, $3 opacidade
  sed -e "s/#fff/$2/g" -e "s|<svg |<svg opacity=\"$3\" |" "${MONO}" > "${DEST}/src/vs/workbench/browser/parts/editor/media/$1"
}
letterpress letterpress-dark.svg    "#B2B2B2" 0.3
letterpress letterpress-light.svg   "#B2B2B2" 0.1
letterpress letterpress-hcDark.svg  "#3C3C3C" 1
letterpress letterpress-hcLight.svg "#B2B2B2" 1

echo "ícones gerados em ${DEST}"
