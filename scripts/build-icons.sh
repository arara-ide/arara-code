#!/usr/bin/env bash
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
DEST="${1:-${ROOT}/branding/src-stable}"
ICON="${ROOT}/branding/icons/arara.svg"
MONO="${ROOT}/branding/icons/arara-mono.svg"

TMP="$( mktemp -d )"
trap 'rm -rf "${TMP}"' EXIT

render_png() {
  local in_svg="$1"
  local size="$2"
  local out_png="$3"

  if command -v rsvg-convert >/dev/null && ! grep -q "shim: rsvg-convert" "$(command -v rsvg-convert)" 2>/dev/null; then
    rsvg-convert -w "${size}" -h "${size}" "${in_svg}" -o "${out_png}"
  elif python3 -c "
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
" 2>/dev/null; then
    :
  else
    echo "erro: renderizador de SVG seguro não encontrado. Instale librsvg2-bin ou python3-gi-cairo." >&2
    exit 1
  fi
}

command -v convert >/dev/null || { echo "faltando: convert (ImageMagick)" >&2; exit 1; }

mkdir -p "${DEST}/resources/linux/rpm"
render_png "${ICON}" 512 "${DEST}/resources/linux/code.png"
cp "${ICON}" "${DEST}/resources/linux/code.svg"
convert "${DEST}/resources/linux/code.png" -resize 256x256 "${DEST}/resources/linux/rpm/code.xpm"

mkdir -p "${DEST}/resources/server"
render_png "${ICON}" 192 "${DEST}/resources/server/code-192.png"
render_png "${ICON}" 512 "${DEST}/resources/server/code-512.png"

mkdir -p "${DEST}/resources/win32"
render_png "${ICON}" 256 "${TMP}/256.png"
convert "${TMP}/256.png" -define icon:auto-resize=256,128,96,64,48,32,24,20,16 "${DEST}/resources/win32/code.ico"
cp "${DEST}/resources/win32/code.ico" "${DEST}/resources/server/favicon.ico"
render_png "${ICON}" 45 "${TMP}/45.png"
convert -size 70x70 canvas:transparent "${TMP}/45.png" -gravity center -composite PNG32:"${DEST}/resources/win32/code_70x70.png"
render_png "${ICON}" 64 "${TMP}/64.png"
convert -size 150x150 canvas:transparent "${TMP}/64.png" -gravity NorthWest -geometry +44+25 -composite PNG32:"${DEST}/resources/win32/code_150x150.png"

bmp() {
  render_png "${ICON}" "$3" "${TMP}/logo.png"
  if [[ "$4" == center ]]; then
    convert -size "$2" xc:white "${TMP}/logo.png" -gravity center -composite -alpha remove -type TrueColor BMP3:"$1"
  else
    convert -size "$2" xc:white "${TMP}/logo.png" -gravity NorthWest -geometry "$4" -composite -alpha remove -type TrueColor BMP3:"$1"
  fi
}
W="${DEST}/resources/win32"
bmp "${W}/inno-big-100.bmp" 164x314 126 center
bmp "${W}/inno-big-125.bmp" 192x386 147 center
bmp "${W}/inno-big-150.bmp" 246x459 190 center
bmp "${W}/inno-big-175.bmp" 273x556 211 center
bmp "${W}/inno-big-200.bmp" 328x604 255 center
bmp "${W}/inno-big-225.bmp" 355x700 273 center
bmp "${W}/inno-big-250.bmp" 410x797 317 center
bmp "${W}/inno-small-100.bmp" 55x55 44 center
bmp "${W}/inno-small-125.bmp" 64x68 52 center
bmp "${W}/inno-small-150.bmp" 83x80 63 center
bmp "${W}/inno-small-175.bmp" 92x97 76 center
bmp "${W}/inno-small-200.bmp" 110x106 86 center
bmp "${W}/inno-small-225.bmp" 119x123 103 center
bmp "${W}/inno-small-250.bmp" 138x140 116 center
MSI="${ROOT}/branding/msi/stable"
mkdir -p "${MSI}"
bmp "${MSI}/wix-banner.bmp" 493x58 50 +438+6
bmp "${MSI}/wix-dialog.bmp" 493x312 120 +22+152

MSIX="${ROOT}/branding/msix"
mkdir -p "${MSIX}"
render_png "${ICON}" 50 "${MSIX}/StoreLogo.png"
render_png "${ICON}" 44 "${MSIX}/Square44x44Logo.png"
render_png "${ICON}" 100 "${TMP}/100.png"
convert -size 150x150 canvas:transparent "${TMP}/100.png" -gravity center -composite PNG32:"${MSIX}/Square150x150Logo.png"

mkdir -p "${DEST}/resources/darwin"
for s in 16 32 64 128 256 512 1024; do render_png "${ICON}" "${s}" "${TMP}/m${s}.png"; done
python3 - "${TMP}" "${DEST}/resources/darwin/code.icns" <<'PY'
import struct, sys
src, out = sys.argv[1], sys.argv[2]
types = [('ic07', 128), ('ic08', 256), ('ic09', 512), ('ic10', 1024),
         ('ic11', 32), ('ic12', 64), ('ic13', 256), ('ic14', 512)]
body = b''
for kind, size in types:
    data = open(f'{src}/m{size}.png', 'rb').read()
    body += kind.encode() + struct.pack('>I', len(data) + 8) + data
open(out, 'wb').write(b'icns' + struct.pack('>I', len(body) + 8) + body)
PY

mkdir -p "${DEST}/src/vs/workbench/browser/media" "${DEST}/src/vs/workbench/browser/parts/editor/media"
cp "${ICON}" "${DEST}/src/vs/workbench/browser/media/code-icon.svg"

letterpress() {
  sed -e "s/#fff/$2/g" -e "s|<svg |<svg opacity=\"$3\" |" "${MONO}" > "${DEST}/src/vs/workbench/browser/parts/editor/media/$1"
}
letterpress letterpress-dark.svg    "#B2B2B2" 0.3
letterpress letterpress-light.svg   "#B2B2B2" 0.1
letterpress letterpress-hcDark.svg  "#3C3C3C" 1
letterpress letterpress-hcLight.svg "#B2B2B2" 1

echo "ícones gerados em ${DEST}"
