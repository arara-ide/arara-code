#!/usr/bin/env bash
# Build do Arara Code.
#
# Fluxo (ver _docs/docs/03-organizacao-git.md):
#   1. copia upstream/vscodium (submódulo, tag fixa) para .work/vscodium  — o submódulo nunca é alterado
#   2. aplica patches/vscodium/*.patch nos scripts do VSCodium
#   3. gera ícones do Arara por cima de .work/vscodium/src/stable
#   4. faz merge de branding/product.overlay.json no product.json do VSCodium
#   5. copia patches/code/*.patch para .work/vscodium/patches/user/ (hook oficial do VSCodium p/ downstream)
#   6. roda get_repo.sh + build.sh do VSCodium com as variáveis de branding exportadas
#
# Uso: scripts/build.sh [--skip-source]   (--skip-source reusa o vscode/ já clonado)
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
UPSTREAM="${ROOT}/upstream/vscodium"
WORK="${ROOT}/.work/vscodium"
SKIP_SOURCE="no"

for arg in "$@"; do
  case "${arg}" in
    --skip-source) SKIP_SOURCE="yes" ;;
    *) echo "opção desconhecida: ${arg}" >&2; exit 1 ;;
  esac
done

[[ -f "${UPSTREAM}/build.sh" ]] || git -C "${ROOT}" submodule update --init

# --- 1. cópia de trabalho (preserva vscode/ quando --skip-source)
mkdir -p "${WORK}"
rsync -a --delete \
  --exclude '/vscode/' --exclude '/VSCode-*/' --exclude '/vscode-reh*/' --exclude '/dev/build.env' \
  "${UPSTREAM}/" "${WORK}/"
rm -f "${WORK}/.git"   # o .git do submódulo é só um ponteiro; não queremos git no work dir

# --- 2. patches nos scripts do VSCodium
shopt -s nullglob
for p in "${ROOT}"/patches/vscodium/*.patch; do
  echo "patch vscodium: $( basename "${p}" )"
  patch -d "${WORK}" -p1 --forward --no-backup-if-mismatch < "${p}"
done

# --- 3. ícones
"${ROOT}/scripts/build-icons.sh" "${WORK}/src/stable"

# --- 4. product.json (o prepare_vscode.sh faz `vscode/product.json * ../product.json`)
jq -s '.[0] * .[1]' "${WORK}/product.json" "${ROOT}/branding/product.overlay.json" > "${WORK}/product.json.tmp"
mv "${WORK}/product.json.tmp" "${WORK}/product.json"

# --- 5. patches no Code-OSS
mkdir -p "${WORK}/patches/user"
for p in "${ROOT}"/patches/code/*.patch; do
  cp "${p}" "${WORK}/patches/user/"
done
shopt -u nullglob

# --- 6. build
export APP_NAME="Arara Code"
export BINARY_NAME="arara-code"
export ORG_NAME="Arara"
export GLOBAL_DIRNAME="arara-code"
export TUNNEL_APP_NAME="arara-code-tunnel"
export GH_REPO_PATH="arara-ide/arara-ide"
export ASSETS_REPOSITORY="arara-ide/arara-ide"

export SHOULD_BUILD="yes"
export SHOULD_BUILD_REH="${SHOULD_BUILD_REH:-no}"
export SHOULD_BUILD_REH_WEB="${SHOULD_BUILD_REH_WEB:-no}"
export CI_BUILD="${CI_BUILD:-no}"
export VSCODE_QUALITY="stable"
export VSCODE_LATEST="no"
export VSCODE_SKIP_NODE_VERSION_CHECK="yes"
export DISABLE_UPDATE="yes"   # sem servidor de update ainda (updateUrl vazio no overlay)
# heap do Node nos passos de gulp; o VSCodium usa 8192 por padrão. Baixe se a máquina tiver pouca RAM.
export MAX_OLD_SPACE_SIZE="${MAX_OLD_SPACE_SIZE:-8192}"

case "${OSTYPE}" in
  darwin*) export OS_NAME="osx" ;;
  msys*|cygwin*) export OS_NAME="windows" ;;
  *) export OS_NAME="linux" ;;
esac
case "$( uname -m )" in
  aarch64|arm64) export VSCODE_ARCH="arm64" ;;
  *) export VSCODE_ARCH="x64" ;;
esac

cd "${WORK}"
# os scripts do VSCodium leem variáveis opcionais não definidas
set +u
if [[ "${SKIP_SOURCE}" == "no" ]]; then
  rm -rf vscode VSCode-* vscode-reh*
  . get_repo.sh
  . version.sh
  { echo "MS_TAG=\"${MS_TAG}\""; echo "MS_COMMIT=\"${MS_COMMIT}\""; echo "RELEASE_VERSION=\"${RELEASE_VERSION}\""; } > dev/build.env
else
  [[ -d vscode ]] || { echo "--skip-source sem vscode/ existente" >&2; exit 1; }
  . dev/build.env
  export MS_TAG MS_COMMIT RELEASE_VERSION
  # volta o vscode/ ao estado limpo da tag antes de reaplicar os patches
  ( cd vscode && git add -A && git reset -q --hard HEAD && git clean -fdq -e node_modules && rm -rf .build out* )
  rm -rf VSCode-*
fi

. build.sh

echo
echo "pronto: ${WORK}/VSCode-${OS_NAME}-${VSCODE_ARCH}"
