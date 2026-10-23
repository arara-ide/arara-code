#!/usr/bin/env bash
# Gera os ícones do Arara Code a partir de branding/icons/*.svg, no layout
# que o VSCodium espera em src/stable/ (que o prepare_vscode.sh copia sobre vscode/).
#
# Uso: scripts/build-icons.sh [diretório-src-stable-de-destino]
# Por padrão gera em branding/src-stable, versionando os assets para o build.
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
DEST="${1:-${ROOT}/branding/src-stable}"
ICON="${ROOT}/branding/icons/arara.svg"
MONO="${ROOT}/branding/icons/arara-mono.svg"

TMP="$( mktemp -d )"
trap 'rm -rf "${TMP}"' EXIT

# Renderiza SVG em PNG com fidelidade de cores (gradientes e máscaras).
# Tenta python3 com librsvg/cairo primeiro; caso indisponível, tenta rsvg-convert real.
render_png() {
  local in_svg="$1"
  local size="$2"
  local out_png="$3"

  if python3 -c "import gi; gi.require_version('Rsvg', '2.0'); from gi.repository import Rsvg; import cairo" 2>/dev/null; then
    python3 -c "
import gi
gi.require_version('Rsvg', '2.0')
from gi.repository import Rsvg
import cairo

handle = Rsvg.Handle.new_from_file('${in_svg}')
surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, ${size}, ${size})
ctx = cairo.Context(surface)
ctx.scale(${size} / 512.0, ${size} / 512.0)
handle.render_cairo(ctx)
surface.write_to_png('${out_png}')
"
  elif command -v rsvg-convert >/dev/null && ! grep -q "shim: rsvg-convert" "$(command -v rsvg-convert)" 2>/dev/null; then
    rsvg-convert -w "${size}" -h "${size}" "${in_svg}" -o "${out_png}"
  else
    echo "erro: renderizador de SVG seguro não encontrado. Instale librsvg2-bin ou python3-gi." >&2
    exit 1
  fi
}

command -v convert >/dev/null || { echo "faltando: convert (ImageMagick)" >&2; exit 1; }

# --- linux
mkdir -p "${DEST}/resources/linux/rpm"
render_png "${ICON}" 512 "${DEST}/resources/linux/code.png"
cp "${ICON}" "${DEST}/resources/linux/code.svg"
convert "${DEST}/resources/linux/code.png" -resize 256x256 "${DEST}/resources/linux/rpm/code.xpm"

# --- server / web
mkdir -p "${DEST}/resources/server"
render_png "${ICON}" 192 "${DEST}/resources/server/code-192.png"
render_png "${ICON}" 512 "${DEST}/resources/server/code-512.png"

# --- windows
mkdir -p "${DEST}/resources/win32"
render_png "${ICON}" 256 "${TMP}/256.png"
convert "${TMP}/256.png" -define icon:auto-resize=256,128,96,64,48,32,24,20,16 "${DEST}/resources/win32/code.ico"
cp "${DEST}/resources/win32/code.ico" "${DEST}/resources/server/favicon.ico"
render_png "${ICON}" 45 "${TMP}/45.png"
convert -size 70x70 canvas:transparent "${TMP}/45.png" -gravity center -composite PNG32:"${DEST}/resources/win32/code_70x70.png"
render_png "${ICON}" 64 "${TMP}/64.png"
convert -size 150x150 canvas:transparent "${TMP}/64.png" -gravity NorthWest -geometry +44+25 -composite PNG32:"${DEST}/resources/win32/code_150x150.png"

# --- macOS
mkdir -p "${DEST}/resources/darwin"
if command -v png2icns >/dev/null; then
  for s in 1024 512 256 128; do render_png "${ICON}" "${s}" "${TMP}/m${s}.png"; done
  png2icns "${DEST}/resources/darwin/code.icns" "${TMP}"/m{1024,512,256,128}.png
elif [[ ! -f "${DEST}/resources/darwin/code.icns" && -f "${ROOT}/upstream/vscodium/src/stable/resources/darwin/code.icns" ]]; then
  cp "${ROOT}/upstream/vscodium/src/stable/resources/darwin/code.icns" "${DEST}/resources/darwin/code.icns"
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
