#!/usr/bin/env bash
# Build do Arara Code.
#
# Fluxo (ver ac-docs/docs/03-organizacao-git.md):
#   1. copia upstream/vscodium (submódulo, tag fixa) para .work/vscodium  — o submódulo nunca é alterado
#   2. aplica patches/vscodium/*.patch nos scripts do VSCodium
#   3. gera ícones do Arara por cima de .work/vscodium/src/stable
#   4. faz merge de branding/product.overlay.json no product.json do VSCodium
#   5. copia patches/code/*.patch para .work/vscodium/patches/user/ (hook oficial do VSCodium p/ downstream)
#   6. roda get_repo.sh + build.sh do VSCodium com as variáveis de branding exportadas
#
# Uso: scripts/build.sh [--skip-source] [--prepare-only] [--no-deb]
#   --skip-source   reusa o vscode/ já clonado
#   --prepare-only  para depois de clone + patches + branding + npm ci (sem compilar); usado pelo scripts/dev.sh
#   --no-deb        só a pasta VSCode-linux-<arch> (sem gerar o .deb)
#
# A extensão ../arara-ai (ARARA_AI_DIR) é compilada e entra como extensão built-in.
# No Linux o resultado vai para dist/: arara-code_<versão>_<arch>.deb e .tar.gz
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
UPSTREAM="${ROOT}/upstream/vscodium"
WORK="${ROOT}/.work/vscodium"
SKIP_SOURCE="no"
PREPARE_ONLY="no"
BUILD_DEB="yes"
ARARA_AI_DIR="${ARARA_AI_DIR:-$( cd "${ROOT}/.." && pwd )/arara-ai}"

for arg in "$@"; do
  case "${arg}" in
    --skip-source) SKIP_SOURCE="yes" ;;
    --prepare-only) PREPARE_ONLY="yes" ;;
    --no-deb) BUILD_DEB="no" ;;
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

# --- 3b. textos do Linux (menu de programas, .deb): sobrescrevem os do VSCodium
cp "${ROOT}"/branding/linux/{code.desktop,code-url-handler.desktop,code.appdata.xml} "${WORK}/src/stable/resources/linux/"

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
export GH_REPO_PATH="arara-ide/arara-code"
export ASSETS_REPOSITORY="arara-ide/arara-code"

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

# --- 7. extensão arara-ai embutida (built-in): o gulp empacota tudo em vscode/extensions/*
embed_arara_ai() {
  [[ -f "${ARARA_AI_DIR}/package.json" ]] || { echo "! ${ARARA_AI_DIR} não encontrado; build sem a extensão de IA" >&2; return 0; }
  echo "» Compilando arara-ai…"
  ( cd "${ARARA_AI_DIR}" && { [[ -d node_modules ]] || npm ci --no-audit --no-fund; } && npm run --silent build )
  local dest="${WORK}/vscode/extensions/arara-ai"
  rm -rf "${dest}"
  mkdir -p "${dest}"
  # mesmo conjunto do .vscodeignore: só o que roda (sem src/, testes, node_modules)
  cp "${ARARA_AI_DIR}/package.json" "${dest}/"
  [[ -f "${ARARA_AI_DIR}/README.md" ]] && cp "${ARARA_AI_DIR}/README.md" "${dest}/"
  [[ -f "${ARARA_AI_DIR}/.vscodeignore" ]] && cp "${ARARA_AI_DIR}/.vscodeignore" "${dest}/"
  mkdir -p "${dest}/dist"
  cp "${ARARA_AI_DIR}/dist/extension.js" "${dest}/dist/"
  cp -r "${ARARA_AI_DIR}/media" "${ARARA_AI_DIR}/themes" "${dest}/"
}

if [[ "${PREPARE_ONLY}" == "yes" ]]; then
  # o mesmo que o build.sh do VSCodium faz antes de chamar o gulp
  . version.sh
  . prepare_vscode.sh
  echo
  echo "pronto (preparado, sem compilar): ${WORK}/vscode"
  exit 0
fi

if [[ "${OS_NAME}" == "linux" ]]; then
  # Mesmo fluxo do build.sh do VSCodium (Linux, sem CI), em etapas, para a
  # extensão e os textos do .deb entrarem depois do prepare_vscode.sh.
  . version.sh
  . prepare_vscode.sh
  embed_arara_ai
  cp "${ROOT}/branding/linux/control.template" vscode/resources/linux/debian/control.template
  (
    cd vscode
    export NODE_OPTIONS="--max-old-space-size=${MAX_OLD_SPACE_SIZE}"
    export VSCODE_PUBLISH_COUNTER=1
    npm run gulp vscode-min-prepack
    rm -f .build/extensions/ms-vscode.js-debug/src/win32-app-container-tokens.*.node
    npm run copy-policy-dto --prefix build
    node build/lib/policies/policyGenerator.ts build/lib/policies/policyData.jsonc linux
    npm run gulp "vscode-linux-${VSCODE_ARCH}-min-packing"
  )
  find "VSCode-linux-${VSCODE_ARCH}" -print0 | xargs -0 touch -c
  # desinstalador junto do programa (bin/arara-code-uninstall; no .deb vira /usr/bin/arara-code-uninstall)
  install -m 755 "${ROOT}/branding/linux/uninstall.sh" "VSCode-linux-${VSCODE_ARCH}/bin/arara-code-uninstall"
  for t in postinst prerm; do
    f="vscode/resources/linux/debian/${t}.template"
    grep -q arara-code-uninstall "${f}" && continue
    if [[ "${t}" == "postinst" ]]; then
      sed -i '0,/^ln -s .*$/s||&\nln -sf /usr/share/@@NAME@@/bin/@@NAME@@-uninstall /usr/bin/@@NAME@@-uninstall|' "${f}"
    else
      printf '\nrm -f /usr/bin/@@NAME@@-uninstall\n' >> "${f}"
    fi
  done
else
  # macOS/Windows: fluxo do VSCodium sem mudanças (extensão embutida ainda só no Linux)
  . build.sh
fi

if [[ "${OS_NAME}" == "linux" ]]; then
  OUT="${ROOT}/dist"
  mkdir -p "${OUT}"
  tar czf "${OUT}/arara-code-linux-${VSCODE_ARCH}-${RELEASE_VERSION}.tar.gz" -C "${WORK}/VSCode-linux-${VSCODE_ARCH}" .
  if [[ "${BUILD_DEB}" == "yes" ]]; then
    # O dpkg-shlibdeps.pl do Chromium não funciona com o dpkg ≥ 1.23 (Ubuntu 26.04+).
    # Nesse caso usa a lista de dependências que o próprio VS Code mantém (dep-lists.ts).
    if ! perl -e 'use Dpkg; exit(($Dpkg::PROGVERSION =~ /^1\.(2[3-9]|[3-9]\d)/) ? 0 : 1)' 2>/dev/null; then :; else
      sed -i 's|\tconst dpkgShlibdepsResult = spawnSync(.perl., cmd, { cwd: chromiumSysroot });|\tconst dpkgShlibdepsResult = { status: 0, stdout: Buffer.from(""), stderr: "" }; // Arara: dpkg novo, usa dep-lists.ts|' "${WORK}/vscode/build/linux/debian/calculate-deps.ts"
      sed -i 's|\tconst sortedDependencies: string\[\] = Array.from(mergedDependencies)|\tif (packageType === "deb" \&\& !mergedDependencies.size) { return [...debianGeneratedDeps[arch as DebianArchString]]; }\n\tconst sortedDependencies: string[] = Array.from(mergedDependencies)|' "${WORK}/vscode/build/linux/dependencies-generator.ts"
    fi
    ( cd "${WORK}/vscode" \
      && npm run gulp "vscode-linux-${VSCODE_ARCH}-prepare-deb" \
      && npm run gulp "vscode-linux-${VSCODE_ARCH}-build-deb" )
    cp "${WORK}"/vscode/.build/linux/deb/*/deb/*.deb "${OUT}/"
  fi
  echo
  echo "pronto:"
  ls -lh "${OUT}"
else
  echo
  echo "pronto: ${WORK}/VSCode-${OS_NAME}-${VSCODE_ARCH}"
fi
