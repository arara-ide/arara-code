#!/usr/bin/env bash
# Abre o Arara Code em modo desenvolvimento, rápido.
#
# - Usa o código do VS Code já preparado em .work/vscodium/vscode (patches + branding
#   aplicados). Se ele não existir, roda o preparo uma vez (clone + npm ci, ~10 min).
# - Só transpila o TypeScript (~10 s, sem typecheck, sem minificar, sem empacotar).
# - Carrega a extensão ../arara-ai direto da pasta (sem .vsix).
# - Perfil isolado em .work/dev-profile (não mexe no seu VS Code/VSCodium).
#
# Uso:
#   scripts/dev.sh                 # abre a IDE
#   scripts/dev.sh ~/meu-projeto   # abre a IDE nessa pasta
#   scripts/dev.sh --production    # desenvolvimento com APIs de produção
#   scripts/dev.sh --reset         # apaga o perfil de dev antes de abrir
#
# Variáveis: ARARA_AI_DIR (padrão ../arara-ai), ARARA_DEV_PROFILE.
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
VSCODE="${ROOT}/.work/vscodium/vscode"
EXT_DIR="${ARARA_AI_DIR:-$( cd "${ROOT}/.." && pwd )/arara-ai}"
DEV_ENVIRONMENT="local"
ENVIRONMENT_SELECTED=""
RESET_PROFILE=false

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

# 1. código do VS Code preparado (uma vez só)
if [[ ! -d "${VSCODE}/node_modules" ]]; then
  echo "» Primeira vez: preparando o código do VS Code (clone + patches + npm ci)…"
  echo "  Isso leva ~10 min e ~9 GB. Nas próximas vezes é instantâneo."
  "${ROOT}/scripts/prepare.sh"
fi

cd "${VSCODE}"

# Atualiza a fonte preparada quando os patches do projeto mudarem.
bash "${ROOT}/scripts/sync-dev-patches.sh"

# Extensões padrão também no perfil de desenvolvimento (preLaunch é pulado).
bash "${ROOT}/scripts/default-extensions.sh" "${VSCODE}"

# 2. prepara a fonte dos ícones antes do transpile copiar os assets para out/.
# O fluxo rápido pula o preLaunch/build-fast, que normalmente faz esta etapa.
echo "» Preparando ícones do workbench…"
npm run --silent gulp copy-codicons >/dev/null
if [[ ! -s src/vs/base/browser/ui/codicons/codicon/codicon.ttf ]]; then
  echo "! Fonte codicon.ttf ausente. Reinstale as dependências do workbench com npm ci." >&2
  exit 1
fi

# 2a. transpile rápido (esbuild, sem typecheck)
echo "» Transpilando o workbench…"
npm run --silent transpile-client >/dev/null
if [[ ! -s out/vs/base/browser/ui/codicons/codicon/codicon.ttf ]]; then
  echo "! O transpile não copiou codicon.ttf para out/. O workbench não será aberto com ícones quebrados." >&2
  exit 1
fi

# 2b. extensões built-in (git, emmet, temas…): só na primeira vez (~10 s)
if [[ ! -f extensions/git/out/main.js ]]; then
  echo "» Compilando extensões built-in (primeira vez)…"
  npm run --silent gulp compile-extensions >/dev/null
fi

# 3. Electron (baixa só se a versão mudou)
if [[ ! -x ".build/electron/$( node -p "require('./product.json').applicationName" )" ]]; then
  echo "» Baixando Electron…"
  npm run --silent electron >/dev/null
fi

# 4. extensão arara-ai
EXT_ARGS=()
if [[ -f "${EXT_DIR}/package.json" ]]; then
  if [[ ! -d "${EXT_DIR}/node_modules" ]]; then
    echo "» Instalando dependências do arara-ai…"
    ( cd "${EXT_DIR}" && npm ci --no-audit --no-fund >/dev/null )
  fi
  echo "» Buildando arara-ai…"
  ( cd "${EXT_DIR}" && npm run --silent build >/dev/null )
  # Mantenha também a extensão embutida do dev atualizada: recursos/hooks podem
  # ser resolvidos por essa cópia em janelas abertas sem extensionDevelopmentPath.
  mkdir -p "${VSCODE}/extensions/arara-ai"
  cp "${EXT_DIR}/package.json" "${VSCODE}/extensions/arara-ai/"
  cp -R "${EXT_DIR}/dist" "${EXT_DIR}/media" "${EXT_DIR}/themes" "${VSCODE}/extensions/arara-ai/"
  node "${ROOT}/scripts/apply-environment.cjs" "${DEV_ENVIRONMENT}" "${VSCODE}/extensions/arara-ai/package.json"
  DEV_EXT_DIR="${EXT_DIR}"
  if [[ "${DEV_ENVIRONMENT}" == production ]]; then
    # O manifesto do checkout continua local. A cópia tem padrões de produção.
    DEV_EXT_DIR="${ROOT}/.work/dev-extensions/production/arara-ai"
    mkdir -p "${DEV_EXT_DIR}"
    cp "${EXT_DIR}/package.json" "${DEV_EXT_DIR}/"
    cp -R "${EXT_DIR}/dist" "${EXT_DIR}/media" "${EXT_DIR}/themes" "${DEV_EXT_DIR}/"
    node "${ROOT}/scripts/apply-environment.cjs" production "${DEV_EXT_DIR}/package.json"
  fi
  EXT_ARGS=("--extensionDevelopmentPath=${DEV_EXT_DIR}")
else
  echo "! ${EXT_DIR} não encontrado; abrindo sem a extensão arara-ai." >&2
fi

mkdir -p "${PROFILE}/data" "${PROFILE}/extensions"

echo "» Abrindo Arara Code (dev, ${DEV_ENVIRONMENT}) — perfil: ${PROFILE}"
# VSCODE_SKIP_PRELAUNCH: pula o preLaunch (que faria npm ci/compile completo se algo faltasse)
VSCODE_SKIP_PRELAUNCH=1 exec ./scripts/code.sh \
  --user-data-dir "${PROFILE}/data" \
  --extensions-dir "${PROFILE}/extensions" \
  "${EXT_ARGS[@]}" \
  "${ARGS[@]}"
