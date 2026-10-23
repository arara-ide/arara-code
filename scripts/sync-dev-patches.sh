#!/usr/bin/env bash
# Atualiza patches já preparados sem apagar fontes, dependências ou o perfil.
set -euo pipefail
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
VSCODE="${ROOT}/.work/vscodium/vscode"
APPLIED="${ROOT}/.work/vscodium/patches/user"

for current in "${ROOT}"/patches/code/*.patch; do
  previous="${APPLIED}/$( basename "${current}" )"
  cmp -s "${current}" "${previous}" && continue
  # A fonte pode ter sido atualizada antes da cópia usada pelo preparo.
  if git -C "${VSCODE}" apply --check --reverse "${current}" 2>/dev/null; then
    mkdir -p "${APPLIED}"
    cp "${current}" "${previous}"
    continue
  fi
  echo "» Atualizando patch de desenvolvimento: $( basename "${current}" )"
  # Falha sem sobrescrever alterações locais caso outro patch tenha dependências.
  if [[ -f "${previous}" ]]; then
    git -C "${VSCODE}" apply --check --reverse "${previous}"
    git -C "${VSCODE}" apply --reverse "${previous}"
  fi
  if ! git -C "${VSCODE}" apply --check "${current}"; then
    if [[ -f "${previous}" ]]; then
      git -C "${VSCODE}" apply "${previous}"
    fi
    echo "! Não foi possível atualizar o patch; a versão anterior foi preservada." >&2
    exit 1
  fi
  git -C "${VSCODE}" apply "${current}"
  mkdir -p "${APPLIED}"
  cp "${current}" "${previous}"
done
