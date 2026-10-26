#!/usr/bin/env bash
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
VSCODE="${ROOT}/.work/vscodium/vscode"
EXT_DIR="${ARARA_AI_DIR:-$( cd "${ROOT}/.." && pwd )/arara-ai}"
BOT_DIR="${ARARA_BOT_DIR:-$( cd "${ROOT}/.." && pwd )/arara-bot}"
ORCH_DIR="${ARARA_ORCHESTRA_DIR:-$( cd "${ROOT}/.." && pwd )/arara-orchestra}"
DEV_ENVIRONMENT="local"
ENVIRONMENT_SELECTED=""
RESET_PROFILE=false

case "${OSTYPE}" in
  msys*|cygwin*)
    if [[ -f "${VSCODE}/.nvmrc" ]]; then
      WINDOWS_NODE_VERSION="$(tr -d '\r\n' < "${VSCODE}/.nvmrc")"
      WINDOWS_NODE_DIR="${ROOT}/.work/windows-tools/node-v${WINDOWS_NODE_VERSION}-win-x64"
      if [[ -f "${WINDOWS_NODE_DIR}/node.exe" ]]; then
        export PATH="${WINDOWS_NODE_DIR}:${PATH}"
      fi
    fi
    ;;
esac

ARGS=()
for arg in "$@"; do
  case "${arg}" in
    --production|--local)
      selected="${arg#--}"
      if [[ -n "${ENVIRONMENT_SELECTED}" && "${ENVIRONMENT_SELECTED}" != "${selected}" ]]; then
        echo '! Use apenas um ambiente: --production ou --local.' >&2
        exit 1
      fi
      DEV_ENVIRONMENT="${selected}"
      ENVIRONMENT_SELECTED="${selected}"
      ;;
    --reset) RESET_PROFILE=true ;;
    *) ARGS+=("${arg}") ;;
  esac
done

PROFILE_DEFAULT="${ROOT}/.work/dev-profile"
if [[ "${DEV_ENVIRONMENT}" == production ]]; then
  PROFILE_DEFAULT="${ROOT}/.work/dev-profile-production"
fi
PROFILE="${ARARA_DEV_PROFILE:-${PROFILE_DEFAULT}}"
if [[ "${RESET_PROFILE}" == true ]]; then rm -rf "${PROFILE}"; fi
node "${ROOT}/scripts/apply-environment.cjs" "${DEV_ENVIRONMENT}"

if [[ ! -d "${VSCODE}/node_modules" ]]; then
  echo "» Primeira vez: preparando o código do VS Code (clone + patches + npm ci)…"
  echo "  Isso leva ~10 min e ~9 GB. Nas próximas vezes é instantâneo."
  "${ROOT}/scripts/prepare.sh"
fi

cd "${VSCODE}"

bash "${ROOT}/scripts/sync-dev-patches.sh"
node "${ROOT}/scripts/prepare-language-detection.cjs" "${VSCODE}"

case "${OSTYPE}" in
  msys*|cygwin*)
    if [[ ! -f node_modules/gulp/bin/gulp.js ]]; then
      echo "» Reparando dependencias incompletas do workbench no Windows…"
      ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
        VSCODE_SKIP_NODE_VERSION_CHECK=1 npm ci --no-audit --no-fund
    fi
    ;;
esac

bash "${ROOT}/scripts/default-extensions.sh" "${VSCODE}"

echo "» Preparando ícones do workbench…"
npm run --silent gulp copy-codicons >/dev/null
if [[ ! -s src/vs/base/browser/ui/codicons/codicon/codicon.ttf ]]; then
  echo "! Fonte codicon.ttf ausente. Reinstale as dependências do workbench com npm ci." >&2
  exit 1
fi

echo "» Transpilando o workbench…"
npm run --silent transpile-client >/dev/null
if [[ ! -s out/vs/base/browser/ui/codicons/codicon/codicon.ttf ]]; then
  echo "! O transpile não copiou codicon.ttf para out/. O workbench não será aberto com ícones quebrados." >&2
  exit 1
fi

if [[ ! -f extensions/git/out/main.js ]]; then
  echo "» Compilando extensões built-in (primeira vez)…"
  npm run --silent gulp compile-extensions >/dev/null
fi

ELECTRON_BIN=".build/electron/$( node -p "require('./product.json').applicationName" )"
case "${OSTYPE}" in
  msys*|cygwin*) ELECTRON_BIN=".build/electron/$( node -p "require('./product.json').nameShort" ).exe" ;;
esac
if [[ ! -x "${ELECTRON_BIN}" ]]; then
  echo "» Baixando Electron…"
  npm run --silent electron >/dev/null
fi

EXT_ARGS=()
if [[ -f "${EXT_DIR}/package.json" ]]; then
  if [[ ! -d "${EXT_DIR}/node_modules" ]]; then
    echo "» Instalando dependências do arara-ai…"
    ( cd "${EXT_DIR}" && npm ci --no-audit --no-fund >/dev/null )
  fi
  echo "» Buildando arara-ai…"
  ( cd "${EXT_DIR}" && npm run --silent build >/dev/null )
  mkdir -p "${VSCODE}/extensions/arara-ai"
  cp "${EXT_DIR}/package.json" "${VSCODE}/extensions/arara-ai/"
  for catalog in "${EXT_DIR}"/package.nls*.json; do [[ ! -f "${catalog}" ]] || cp "${catalog}" "${VSCODE}/extensions/arara-ai/"; done
  cp -R "${EXT_DIR}/dist" "${EXT_DIR}/media" "${EXT_DIR}/themes" "${VSCODE}/extensions/arara-ai/"
  node "${ROOT}/scripts/apply-environment.cjs" "${DEV_ENVIRONMENT}" "${VSCODE}/extensions/arara-ai/package.json"
  DEV_EXT_DIR="${EXT_DIR}"
  if [[ "${DEV_ENVIRONMENT}" == production ]]; then
    DEV_EXT_DIR="${ROOT}/.work/dev-extensions/production/arara-ai"
    mkdir -p "${DEV_EXT_DIR}"
    cp "${EXT_DIR}/package.json" "${DEV_EXT_DIR}/"
    for catalog in "${EXT_DIR}"/package.nls*.json; do [[ ! -f "${catalog}" ]] || cp "${catalog}" "${DEV_EXT_DIR}/"; done
    cp -R "${EXT_DIR}/dist" "${EXT_DIR}/media" "${EXT_DIR}/themes" "${DEV_EXT_DIR}/"
    node "${ROOT}/scripts/apply-environment.cjs" production "${DEV_EXT_DIR}/package.json"
  fi
  EXT_ARGS=("--extensionDevelopmentPath=${DEV_EXT_DIR}")
else
  echo "! ${EXT_DIR} não encontrado; abrindo sem a extensão arara-ai." >&2
fi

if [[ -f "${BOT_DIR}/extension/package.json" ]]; then
  if [[ ! -s "${BOT_DIR}/extension/server/index.js" || "${ARARA_BOT_REBUILD:-0}" == 1 ]]; then
    echo "» Compilando arara-bot (servidor)…"
    ( cd "${BOT_DIR}" && { [[ -d node_modules ]] || pnpm install --frozen-lockfile >/dev/null; } && pnpm build:server >/dev/null )
    ( cd "${BOT_DIR}/extension" && npm run --silent stage )
  fi
  ( cd "${BOT_DIR}/extension" && { [[ -d node_modules ]] || npm ci --no-audit --no-fund >/dev/null; } && npm run --silent build >/dev/null )
  EXT_ARGS+=("--extensionDevelopmentPath=${BOT_DIR}/extension")
else
  echo "! ${BOT_DIR} não encontrado; abrindo sem o Arara Bot." >&2
fi

if [[ -f "${ORCH_DIR}/package.json" ]]; then
  echo "» Buildando arara-orchestra…"
  ( cd "${ORCH_DIR}" && { [[ -d node_modules ]] || npm ci --no-audit --no-fund >/dev/null; } && npm run --silent build >/dev/null )
  EXT_ARGS+=("--extensionDevelopmentPath=${ORCH_DIR}")
else
  echo "! ${ORCH_DIR} não encontrado; abrindo sem a Orquestra." >&2
fi

mkdir -p "${PROFILE}/data" "${PROFILE}/extensions"

echo "» Abrindo Arara Code (dev, ${DEV_ENVIRONMENT}) — perfil: ${PROFILE}"
case "${OSTYPE}" in
  msys*|cygwin*)
    unset ELECTRON_RUN_AS_NODE
    NODE_ENV=development VSCODE_DEV=1 VSCODE_CLI=1 \
      ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1 \
      exec "${ELECTRON_BIN}" . --disable-extension=vscode.vscode-api-tests \
      --user-data-dir "${PROFILE}/data" \
      --extensions-dir "${PROFILE}/extensions" \
      "${EXT_ARGS[@]}" "${ARGS[@]}"
    ;;
esac
VSCODE_SKIP_PRELAUNCH=1 exec ./scripts/code.sh \
  --user-data-dir "${PROFILE}/data" \
  --extensions-dir "${PROFILE}/extensions" \
  "${EXT_ARGS[@]}" \
  "${ARGS[@]}"
