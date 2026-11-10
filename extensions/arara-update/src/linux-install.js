'use strict';

const fs = require('node:fs/promises');
const { dirname, join, isAbsolute } = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { systemdArgument, desktopEnvironment } = require('./linux-restart');

const APPIMAGE_SWAP = `set -eu
stage="$1"
destination="$2"
pid="$3"
for attempt in $(/usr/bin/seq 1 300); do
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  /bin/sleep 1
done
if kill -0 "$pid" 2>/dev/null; then /bin/rm -rf "$stage"; exit 1; fi
/bin/mv "$destination" "$stage/previous"
if ! /bin/mv "$stage/incoming" "$destination"; then /bin/mv "$stage/previous" "$destination"; exit 1; fi
/usr/bin/env -u ELECTRON_RUN_AS_NODE -u APPIMAGE -u APPDIR -u VSCODE_PID -u VSCODE_IPC_HOOK_CLI "$destination" &
child=$!
/bin/sleep 2
if ! kill -0 "$child" 2>/dev/null; then
  if wait "$child"; then /bin/rm -rf "$stage"; exit 0; fi
  /bin/mv "$destination" "$stage/incoming"
  /bin/mv "$stage/previous" "$destination"
  exec "$destination"
fi
/bin/rm -rf "$stage"
wait "$child"
`;

async function installAppImage(file, destination, pid, deps = {}) {
  if (!isAbsolute(file) || !isAbsolute(destination) || !Number.isSafeInteger(pid) || pid < 2 || file === destination) throw new Error('Invalid AppImage update');
  const io = deps.fs || fs;
  const run = deps.execFile || promisify(execFile);
  const existing = await io.lstat(destination);
  if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('Unsafe AppImage destination');
  const stage = await io.mkdtemp(join(dirname(destination), '.arara-appimage-'));
  let prepared = false;
  try {
    await io.chmod(stage, 0o700);
    await io.copyFile(file, join(stage, 'incoming'));
    await io.chmod(join(stage, 'incoming'), 0o755);
    const script = join(stage, 'install.sh');
    await io.writeFile(script, APPIMAGE_SWAP, { mode: 0o700, flag: 'wx' });
    const command = ['/bin/sh', script, stage, destination, String(pid)].map(systemdArgument);
    await run('/usr/bin/systemd-run', ['--user', '--quiet', '--collect', '--property=Type=exec', ...desktopEnvironment(deps.env || process.env), '--', ...command], { timeout: 10000 });
    prepared = true;
  } finally { if (!prepared) await io.rm(stage, { recursive: true, force: true }); }
}

module.exports = { installAppImage, APPIMAGE_SWAP };
