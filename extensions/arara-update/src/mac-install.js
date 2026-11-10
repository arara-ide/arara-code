'use strict';

const { spawn, execFile: execute } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const { homedir, tmpdir } = require('node:os');
const { join, dirname } = require('node:path');

const PRODUCTS = {
  'arara-code': { name: 'Arara Code.app', id: 'com.arara.code' },
  'arara-vibes': { name: 'Arara Vibes.app', id: 'br.app.code.arara.vibes' },
};

const SWAP_SCRIPT = `set -eu
stage="$1"
destination="$2"
pid="$3"
backup="$stage/previous.app"
incoming="$stage/incoming.app"
for attempt in $(/usr/bin/seq 1 300); do
  if ! /bin/kill -0 "$pid" 2>/dev/null; then break; fi
  /bin/sleep 1
done
if /bin/kill -0 "$pid" 2>/dev/null; then /bin/rm -rf "$stage"; exit 1; fi
if [ -e "$destination" ]; then /bin/mv "$destination" "$backup"; fi
if ! /bin/mv "$incoming" "$destination"; then
  if [ -e "$backup" ]; then /bin/mv "$backup" "$destination"; fi
  exit 1
fi
if ! /usr/bin/open "$destination"; then
  /bin/mv "$destination" "$incoming"
  if [ -e "$backup" ]; then /bin/mv "$backup" "$destination"; /usr/bin/open "$destination"; fi
  exit 1
fi
/bin/rm -rf "$stage"
`;

function macDestination(product, appRoot, home = homedir()) {
  const info = PRODUCTS[product];
  if (!info) throw new Error('Unknown application');
  if (appRoot) {
    const match = /^(.*\.app)\/Contents(?:\/|$)/.exec(appRoot);
    if (!match || ![ '/Applications', join(home, 'Applications') ].includes(dirname(match[1]))) throw new Error('Move the application to Applications before updating');
    return match[1];
  }
  return join('/Applications', info.name);
}

async function macMainPid(appRoot, execFile = promisify(execute)) {
  const bundle = /^(.*\.app)\/Contents(?:\/|$)/.exec(appRoot)?.[1];
  if (!bundle) throw new Error('Application bundle unavailable');
  const result = await execFile('/bin/ps', ['-axo', 'pid=,comm=']);
  const matches = result.stdout.split('\n').map(line => /^\s*(\d+)\s+(.+)$/.exec(line)).filter(match => match?.[2].startsWith(`${bundle}/Contents/MacOS/`));
  if (matches.length !== 1) throw new Error('Application process unavailable');
  return Number(matches[0][1]);
}

async function installMacDmg(file, product, options = {}, deps = {}) {
  const info = PRODUCTS[product];
  if (!info || !file.endsWith('.dmg')) throw new Error('Invalid application installer');
  const io = deps.fs || fs;
  const execFile = deps.execFile || promisify(execute);
  const launch = deps.spawn || spawn;
  const home = options.home || homedir();
  let destination = macDestination(product, options.appRoot, home);
  const existing = await io.lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Unsafe application destination');
  if (!options.appRoot && !existing) {
    try { await io.access(dirname(destination), 2); }
    catch { destination = join(home, 'Applications', info.name); await io.mkdir(dirname(destination), { recursive: true }); }
  }
  const destinationInfo = await io.lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (destinationInfo && (!destinationInfo.isDirectory() || destinationInfo.isSymbolicLink())) throw new Error('Unsafe application destination');
  const identity = async app => {
    const result = await execFile('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(app, 'Contents/Info.plist')]);
    if (result.stdout.trim() !== info.id) throw new Error('Unexpected application identity');
  };
  if (destinationInfo) await identity(destination);
  if (options.waitPid !== undefined && (!Number.isSafeInteger(options.waitPid) || options.waitPid < 2)) throw new Error('Invalid application process');
  if (!options.waitPid && destinationInfo) {
    const processes = await execFile('/bin/ps', ['-axo', 'command=']);
    if (processes.stdout.split('\n').some(line => line.trim().startsWith(`${destination}/Contents/`))) throw new Error('Close the application before installing');
  }
  const mount = await io.mkdtemp(join(options.tmpdir || tmpdir(), 'arara-install-'));
  let stage;
  let mounted = false;
  let handedOff = false;
  try {
    await execFile('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, file]);
    mounted = true;
    const entries = (await io.readdir(mount)).filter(name => name.endsWith('.app'));
    if (entries.length !== 1) throw new Error('Expected one application in disk image');
    const source = join(mount, entries[0]);
    const sourceInfo = await io.lstat(source);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error('Unsafe application source');
    await identity(source);
    stage = await io.mkdtemp(join(dirname(destination), '.arara-install-'));
    await io.chmod(stage, 0o700);
    const incoming = join(stage, 'incoming.app');
    await execFile('/usr/bin/ditto', ['--norsrc', '--noextattr', '--noacl', source, incoming]);
    await execFile('/usr/bin/codesign', ['--verify', '--deep', '--strict', incoming]);
    await execFile('/usr/sbin/spctl', ['--assess', '--type', 'execute', incoming]);
    await identity(incoming);
    if (options.waitPid) {
      const script = join(stage, 'install.sh');
      await io.writeFile(script, SWAP_SCRIPT, { mode: 0o700, flag: 'wx' });
      const log = await io.open(join(stage, 'install.log'), 'wx', 0o600);
      try {
        await new Promise((resolve, reject) => {
          const child = launch('/bin/bash', [script, stage, destination, String(options.waitPid)], { detached: true, stdio: ['ignore', log.fd, log.fd] });
          child.once('error', reject);
          child.once('spawn', () => { child.unref(); resolve(); });
        });
      } finally { await log.close(); }
      handedOff = true;
    } else {
      const backup = join(stage, 'previous.app');
      if (destinationInfo) await io.rename(destination, backup);
      try {
        await io.rename(incoming, destination);
        if (options.open !== false) await execFile('/usr/bin/open', [destination]);
      } catch (error) {
        if (await io.lstat(destination).catch(() => null)) await io.rename(destination, incoming);
        if (destinationInfo) await io.rename(backup, destination);
        throw error;
      }
    }
    return destination;
  } finally {
    if (mounted) await execFile('/usr/bin/hdiutil', ['detach', mount]).catch(() => {});
    await io.rmdir(mount).catch(() => {});
    if (stage && !handedOff && !await io.lstat(join(stage, 'previous.app')).catch(() => null)) await io.rm(stage, { recursive: true, force: true });
  }
}

module.exports = { installMacDmg, macDestination, macMainPid, SWAP_SCRIPT };
