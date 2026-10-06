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
#   scripts/dev.sh --reset         # apaga o perfil de dev antes de abrir
#
# Variáveis: ARARA_AI_DIR (padrão ../arara-ai), ARARA_DEV_PROFILE.
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
VSCODE="${ROOT}/.work/vscodium/vscode"
EXT_DIR="${ARARA_AI_DIR:-$( cd "${ROOT}/.." && pwd )/arara-ai}"
PROFILE="${ARARA_DEV_PROFILE:-${ROOT}/.work/dev-profile}"

ARGS=()
for arg in "$@"; do
  case "${arg}" in
    --reset) rm -rf "${PROFILE}" ;;
    *) ARGS+=("${arg}") ;;
  esac
done

# 1. código do VS Code preparado (uma vez só)
if [[ ! -d "${VSCODE}/node_modules" ]]; then
  echo "» Primeira vez: preparando o código do VS Code (clone + patches + npm ci)…"
  echo "  Isso leva ~10 min e ~9 GB. Nas próximas vezes é instantâneo."
  "${ROOT}/scripts/prepare.sh"
fi

cd "${VSCODE}"

# 2. transpile rápido (esbuild, sem typecheck)
echo "» Transpilando o workbench…"
npm run --silent transpile-client >/dev/null

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
  EXT_ARGS=(--extensionDevelopmentPath="${EXT_DIR}")
else
  echo "! ${EXT_DIR} não encontrado; abrindo sem a extensão arara-ai." >&2
fi

mkdir -p "${PROFILE}/data" "${PROFILE}/extensions"

echo "» Abrindo Arara Code (dev)…"
# VSCODE_SKIP_PRELAUNCH: pula o preLaunch (que faria npm ci/compile completo se algo faltasse)
VSCODE_SKIP_PRELAUNCH=1 exec ./scripts/code.sh \
  --user-data-dir "${PROFILE}/data" \
  --extensions-dir "${PROFILE}/extensions" \
  "${EXT_ARGS[@]}" \
  "${ARGS[@]}"
