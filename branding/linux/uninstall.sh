#!/usr/bin/env bash
set -euo pipefail

ALL="no"
[[ "${1:-}" == "--all" ]] && ALL="yes"

LOCALE_RAW="${LC_ALL:-${LC_MESSAGES:-${LANG:-en}}}"
case "${LOCALE_RAW}" in
  pt|pt[-_.@]*|PT|PT[-_.@]*) UI_LANG="pt" ;;
  es|es[-_.@]*|ES|ES[-_.@]*) UI_LANG="es" ;;
  *) UI_LANG="en" ;;
esac

case "${UI_LANG}" in
  pt)
    MSG_REMOVING_PKG="Removendo o pacote arara-code (pede sua senha)…"
    MSG_REMOVING_DIR="Removendo %s…"
    MSG_REMOVING_DATA="Apagando configurações, extensões e conversas…"
    MSG_DONE="Pronto. Arara Code removido."
    MSG_KEPT_CONFIG="Suas configurações continuam em ~/.config/Arara Code (apague com: arara-code-uninstall --all)."
    ;;
  es)
    MSG_REMOVING_PKG="Eliminando el paquete arara-code (pedirá tu contraseña)…"
    MSG_REMOVING_DIR="Eliminando %s…"
    MSG_REMOVING_DATA="Borrando configuración, extensiones y conversaciones…"
    MSG_DONE="Listo. Arara Code eliminado."
    MSG_KEPT_CONFIG="Tu configuración sigue en ~/.config/Arara Code (bórrala con: arara-code-uninstall --all)."
    ;;
  *)
    MSG_REMOVING_PKG="Removing the arara-code package (asks for your password)…"
    MSG_REMOVING_DIR="Removing %s…"
    MSG_REMOVING_DATA="Deleting settings, extensions and conversations…"
    MSG_DONE="Done. Arara Code removed."
    MSG_KEPT_CONFIG="Your settings remain in ~/.config/Arara Code (delete with: arara-code-uninstall --all)."
    ;;
esac

if dpkg -s arara-code >/dev/null 2>&1; then
  echo "${MSG_REMOVING_PKG}"
  sudo apt-get remove -y arara-code
else
  DIR="$( cd "$( dirname "$( readlink -f "${BASH_SOURCE[0]}" )" )/.." && pwd )"
  if [[ -x "${DIR}/arara-code" ]]; then
    printf "${MSG_REMOVING_DIR}\n" "${DIR}"
    rm -rf "${DIR}"
  fi
  rm -f "${HOME}/.local/share/applications/arara-code.desktop" "${HOME}/.local/bin/arara-code"
fi

if [[ "${ALL}" == "yes" ]]; then
  echo "${MSG_REMOVING_DATA}"
  rm -rf "${HOME}/.config/Arara Code" "${HOME}/.arara-code"
fi

echo "${MSG_DONE}"
[[ "${ALL}" == "no" ]] && echo "${MSG_KEPT_CONFIG}"
exit 0
