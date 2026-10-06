#!/usr/bin/env bash
# Prepara .work/vscodium/vscode (clone na tag + patches + branding + npm ci) sem compilar.
# Usado pelo scripts/dev.sh na primeira vez. Repasse --skip-source para reaproveitar o clone.
set -euo pipefail
exec "$( dirname "${BASH_SOURCE[0]}" )/build.sh" --prepare-only "$@"
