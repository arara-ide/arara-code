'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { access, readlink } = require('node:fs/promises');
const { t } = require('./i18n');

const RESTART_SCRIPT = `pid="$1"
for attempt in $(/usr/bin/seq 1 300); do
  if ! kill -0 "$pid" 2>/dev/null; then
    exec /usr/bin/env -u ELECTRON_RUN_AS_NODE -u VSCODE_PID -u VSCODE_IPC_HOOK_CLI "$2"
  fi
  /bin/sleep 1
done
exit 1`;

const systemdArgument = value => value.split('$').join('$$').split('%').join('%%');

function desktopEnvironment(env) {
  return ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'].filter(name => env[name]).map(name => `--setenv=${name}=${env[name]}`);
}

async function prepareLinuxRestart(pid, deps = {}) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('Invalid application process');
  const check = deps.access || access;
  const run = deps.execFile || promisify(execFile);
  const env = deps.env || process.env;
  const mainExecutable = deps.executable || (await (deps.readlink || readlink)(`/proc/${pid}/exe`)).replace(/ \(deleted\)$/, '');
  const executable = env.APPIMAGE || mainExecutable;
  if (!executable.startsWith('/')) throw new Error('Invalid application executable');
  await check(executable, 1);
  const unit = `arara-code-restart-${pid}`;
  await run('/usr/bin/systemctl', ['--user', 'stop', `${unit}.service`], { timeout: 10_000 }).catch(() => {});
  const environment = desktopEnvironment(env);
  await run('/usr/bin/systemd-run', ['--user', '--quiet', '--collect', '--property=Type=exec', `--unit=${unit}`, ...environment, '--', '/bin/sh', '-c', systemdArgument(RESTART_SCRIPT), 'arara-code-restart', String(pid), systemdArgument(executable)], { timeout: 10_000 });
  return true;
}

function registerLinuxRestart(context, vscode, deps = {}) {
  if ((deps.platform || process.platform) !== 'linux' || (vscode.env.remoteName && context.extension?.extensionKind === vscode.ExtensionKind.Workspace)) return;
  context.subscriptions.push(vscode.commands.registerCommand('arara.update.prepareRestart', async pid => {
    try { return await (deps.prepareLinuxRestart || prepareLinuxRestart)(pid); }
    catch {
      void vscode.window.showErrorMessage(t('Could not prepare automatic restart. Arara Code will stay open. Close it and reopen it to use the update.'));
      return false;
    }
  }));
}

module.exports = { prepareLinuxRestart, registerLinuxRestart, RESTART_SCRIPT, systemdArgument, desktopEnvironment };
