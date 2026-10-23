#!/usr/bin/env bash
# Desinstala o Arara Code (Linux).
#   arara-code-uninstall          remove o programa, mantém configurações e conversas
#   arara-code-uninstall --all    remove também configurações, extensões e conversas
set -euo pipefail

ALL="no"
[[ "${1:-}" == "--all" ]] && ALL="yes"

if dpkg -s arara-code >/dev/null 2>&1; then
  echo "Removendo o pacote arara-code (pede sua senha)…"
  sudo apt-get remove -y arara-code
else
  # instalado pelo .tar.gz: apaga a pasta onde este script está
  DIR="$( cd "$( dirname "$( readlink -f "${BASH_SOURCE[0]}" )" )/.." && pwd )"
  if [[ -x "${DIR}/arara-code" ]]; then
    echo "Removendo ${DIR}…"
    rm -rf "${DIR}"
  fi
  rm -f "${HOME}/.local/share/applications/arara-code.desktop" "${HOME}/.local/bin/arara-code"
fi

if [[ "${ALL}" == "yes" ]]; then
  echo "Apagando configurações, extensões e conversas…"
  rm -rf "${HOME}/.config/Arara Code" "${HOME}/.arara-code"
fi

echo "Pronto. Arara Code removido."
[[ "${ALL}" == "no" ]] && echo "Suas configurações continuam em ~/.config/Arara Code (apague com: arara-code-uninstall --all)."
exit 0
