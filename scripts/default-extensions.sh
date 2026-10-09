#!/usr/bin/env bash
# Baixa extensões pré-compiladas do Open VSX e registra no fluxo built-in do Code-OSS.
# Uso: scripts/default-extensions.sh /caminho/para/vscode
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
VSCODE="${1:?informe a pasta do Code-OSS preparado}"
CACHE="${ROOT}/.work/extensions"
mkdir -p "${CACHE}" "${VSCODE}/.build/builtInExtensions"

checksum() {
  node -e 'const fs = require("node:fs"); const crypto = require("node:crypto"); process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$1"
}

while IFS= read -r entry; do
  name="$(jq -r '.name' <<< "${entry}")"
  version="$(jq -r '.version' <<< "${entry}")"
  expected="$(jq -r '.sha256' <<< "${entry}")"
  vsix="${CACHE}/${name}-${version}.vsix"
  if [[ ! -f "${vsix}" ]] || [[ "$(checksum "${vsix}")" != "${expected}" ]]; then
    echo "» Baixando ${name}@${version} (Open VSX)…"
    temp="$(mktemp "${CACHE}/download.XXXXXX")"
    curl --fail --location --retry 3 "$(jq -r '.url' <<< "${entry}")" -o "${temp}"
    if [[ "$(checksum "${temp}")" != "${expected}" ]]; then
      rm -f "${temp}"
      echo "! SHA256 inválido para ${name}@${version}" >&2
      exit 1
    fi
    mv "${temp}" "${vsix}"
  fi

  dest="${VSCODE}/.build/builtInExtensions/${name}"
  if [[ ! -f "${dest}/package.json" ]] || [[ "$(jq -r '.version' "${dest}/package.json")" != "${version}" ]]; then
    temp="$(mktemp -d "${CACHE}/extract.XXXXXX")"
    unzip -q "${vsix}" 'extension/*' -d "${temp}"
    jq -e --arg name "${name}" --arg version "${version}" \
      '(.publisher + "." + .name) == $name and .version == $version' \
      "${temp}/extension/package.json" >/dev/null
    rm -rf "${dest}"
    mv "${temp}/extension" "${dest}"
    rmdir "${temp}"
  fi

  # O gulp usa a cópia extraída; o VSIX local permite recriá-la caso .build seja limpo.
  relative="$(node -e 'process.stdout.write(require("node:path").relative(process.argv[1], process.argv[2]))' "${VSCODE}" "${vsix}")"
  definition="$(jq --arg vsix "${relative}" 'del(.url) + {vsix: $vsix}' <<< "${entry}")"
  jq --argjson extension "${definition}" \
    '.builtInExtensions = ((.builtInExtensions // [] | map(select(.name != $extension.name))) + [$extension])' \
    "${VSCODE}/product.json" > "${VSCODE}/product.json.tmp"
  mv "${VSCODE}/product.json.tmp" "${VSCODE}/product.json"
done < <(jq -c '.[]' "${ROOT}/extensions.lock.json")
