#!/usr/bin/env bash
# Protege (bytecode V8) uma lista de bundles CommonJS usando o Electron informado.
# O bytecode só carrega na mesma versão de V8 que o gerou, então o ELECTRON_BIN DEVE ser o
# mesmo Electron que vai executar as extensões (o embarcado desta build). Falha alto se o
# binário ou algum arquivo não existir — nunca "protege" silenciosamente de forma quebrada.
set -euo pipefail

ELECTRON_BIN="${1:?informe o binário do Electron embarcado}"; shift
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

[[ -x "${ELECTRON_BIN}" ]] || { echo "! Electron não encontrado/executável: ${ELECTRON_BIN}" >&2; exit 1; }

files=()
for f in "$@"; do
  if [[ -f "${f}" ]]; then
    files+=("${f}")
  else
    echo "  (pulado — ausente: ${f})"
  fi
done

[[ ${#files[@]} -gt 0 ]] || { echo "! nenhum arquivo CommonJS para proteger" >&2; exit 1; }

echo "» Protegendo ${#files[@]} bundle(s) com bytecode V8 (${ELECTRON_BIN})…"
ELECTRON_RUN_AS_NODE=1 "${ELECTRON_BIN}" "${SCRIPT_DIR}/compile-bytecode.cjs" "${files[@]}"
