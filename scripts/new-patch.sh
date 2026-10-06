#!/usr/bin/env bash
# Gera/atualiza um patch em patches/code/ a partir de arquivos editados em .work/vscodium/vscode.
#
# O "antes" de cada arquivo é reconstruído: versão da tag (git HEAD do vscode/)
# + patches do VSCodium + nossos patches com nome menor que o deste.
#
# Uso:
#   scripts/new-patch.sh 0003-minha-mudanca src/vs/caminho/arquivo.ts [mais arquivos…]
#
# Se o patch já existe, o cabeçalho (texto antes do primeiro "--- a/") é mantido.
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
WORK="${ROOT}/.work/vscodium"
VSCODE="${WORK}/vscode"
NAME="${1:?uso: new-patch.sh NNNN-nome arquivo [arquivo…]}"
NAME="${NAME%.patch}"
shift
[[ $# -gt 0 ]] || { echo "informe os arquivos alterados (relativos a vscode/)" >&2; exit 1; }
FILES=("$@")
OUT="${ROOT}/patches/code/${NAME}.patch"

TMP="$( mktemp -d )"
trap 'rm -rf "${TMP}"' EXIT
BASE="${TMP}/base"
mkdir -p "${BASE}"

# 1. versão da tag
for f in "${FILES[@]}"; do
  mkdir -p "${BASE}/$( dirname "${f}" )"
  git -C "${VSCODE}" show "HEAD:${f}" > "${BASE}/${f}" 2>/dev/null || : > "${BASE}/${f}"
done

# 2. patches na mesma ordem do VSCodium, depois os nossos anteriores a este
PATCHES=("${WORK}"/patches/*.patch "${WORK}"/patches/linux/*.patch)
for p in "${ROOT}"/patches/code/*.patch; do
  [[ -f "${p}" && "$( basename "${p}" .patch )" < "${NAME}" ]] && PATCHES+=("${p}")
done

INCLUDES=()
for f in "${FILES[@]}"; do INCLUDES+=(--include="${f}"); done

# variáveis de branding que o VSCodium substitui nos patches (!!APP_NAME!! etc.)
APP_NAME="Arara Code"; BINARY_NAME="arara-code"; ORG_NAME="Arara"; GLOBAL_DIRNAME="arara-code"
TUNNEL_APP_NAME="arara-code-tunnel"; GH_REPO_PATH="arara-ide/arara-ide"; ASSETS_REPOSITORY="arara-ide/arara-ide"
APP_NAME_LC="arara code"; RELEASE_VERSION="$( sed -n 's/^RELEASE_VERSION="\(.*\)"/\1/p' "${WORK}/dev/build.env" 2>/dev/null || true )"

for p in "${PATCHES[@]}"; do
  [[ -f "${p}" ]] || continue
  sed -e "s|!!APP_NAME!!|${APP_NAME}|g" -e "s|!!APP_NAME_LC!!|${APP_NAME_LC}|g" \
      -e "s|!!BINARY_NAME!!|${BINARY_NAME}|g" -e "s|!!ORG_NAME!!|${ORG_NAME}|g" \
      -e "s|!!GLOBAL_DIRNAME!!|${GLOBAL_DIRNAME}|g" -e "s|!!TUNNEL_APP_NAME!!|${TUNNEL_APP_NAME}|g" \
      -e "s|!!GH_REPO_PATH!!|${GH_REPO_PATH}|g" -e "s|!!ASSETS_REPOSITORY!!|${ASSETS_REPOSITORY}|g" \
      -e "s|!!RELEASE_VERSION!!|${RELEASE_VERSION}|g" "${p}" > "${TMP}/p.patch"
  ( cd "${BASE}" && git apply --ignore-whitespace "${INCLUDES[@]}" "${TMP}/p.patch" ) \
    || { echo "falhou ao reconstruir a base com $( basename "${p}" )" >&2; exit 1; }
done

# 3. cabeçalho
HEADER=""
[[ -f "${OUT}" ]] && HEADER="$( sed '/^--- a\//,$d' "${OUT}" )"
if [[ -z "${HEADER//[[:space:]]/}" ]]; then
  HEADER="Arara Code: TODO o que este patch faz.

Why a patch: TODO por que não dá pela API de extensão.
Touches: ${FILES[*]}
"
fi

# 4. diff
{
  printf '%s\n\n' "${HEADER%$'\n'}"
  for f in "${FILES[@]}"; do
    diff -u --label "a/${f}" --label "b/${f}" "${BASE}/${f}" "${VSCODE}/${f}" || true
  done
} > "${OUT}"

echo "gerado: ${OUT}"
