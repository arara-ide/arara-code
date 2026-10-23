#!/usr/bin/env bash
# Preparo incremental para desenvolvimento. A primeira execução usa prepare.sh;
# execuções seguintes reaproveitam o checkout e node_modules quando possível.
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
WORK="${ROOT}/.work/vscodium"
CACHE="${WORK}/.prepare-fast"
VSCODE="${WORK}/vscode"

if (( $# > 1 )) || { (( $# == 1 )) && [[ "$1" != --skip-source ]]; }; then
  echo "uso: scripts/prepare-fast.sh [--skip-source]" >&2
  exit 2
fi

# O hash inclui tudo que muda o preparo fora dos patches do Code-OSS.
# Os patches do Code-OSS têm um caminho incremental próprio abaixo.
fingerprint() {
  printf '%s\n' "$(uname -s)" "$(uname -m)" \
    "${MAX_OLD_SPACE_SIZE:-8192}" "${SHOULD_BUILD_REH:-no}" \
    "${SHOULD_BUILD_REH_WEB:-no}" "${CI_BUILD:-no}"
  git -C "${ROOT}/upstream/vscodium" rev-parse HEAD
  while IFS= read -r file; do
    printf '%s %s\n' "${file}" "$(git hash-object "${file}")"
  done < <(find "${ROOT}/branding" "${ROOT}/patches/vscodium" \
    -type f | LC_ALL=C sort)
  for file in \
    "${ROOT}/scripts/build.sh" \
    "${ROOT}/scripts/prepare.sh" \
    "${ROOT}/scripts/build-icons.sh" \
    "${ROOT}/scripts/default-extensions.sh" \
    "${ROOT}/scripts/apply-environment.cjs" \
    "${ROOT}/.arara-environment"; do
    if [[ -f "${file}" ]]; then
      printf '%s %s\n' "${file}" "$(git hash-object "${file}")"
    fi
  done
}

current="$(fingerprint | git hash-object --stdin)"
patch_names="$(find "${ROOT}/patches/code" -maxdepth 1 -name '*.patch' -exec basename {} \; | LC_ALL=C sort)"

if [[ -f "${CACHE}" && -d "${VSCODE}/node_modules" && -f "${WORK}/dev/build.env" ]]; then
  read -r previous < "${CACHE}"
  previous_names="$(tail -n +2 "${CACHE}")"
  if [[ "${current}" == "${previous}" && "${patch_names}" == "${previous_names}" ]]; then
    "${ROOT}/scripts/sync-dev-patches.sh"
    echo "pronto (preparo incremental): ${VSCODE}"
    exit 0
  fi
fi

if [[ -d "${VSCODE}/.git" ]]; then
  "${ROOT}/scripts/prepare.sh" --skip-source
else
  "${ROOT}/scripts/prepare.sh"
fi
{ printf '%s\n' "${current}"; printf '%s\n' "${patch_names}"; } > "${CACHE}.tmp"
mv "${CACHE}.tmp" "${CACHE}"
