'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { installMacDmg, macUpdateRequirement } = require('../../extensions/arara-update/src/mac-install');

const native = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function stopIsolatedApp(destination) {
  const { stdout } = await native('/bin/ps', ['-axo', 'pid=,comm=']);
  const pids = stdout.split('\n').map(line => /^\s*(\d+)\s+(.+)$/.exec(line))
    .filter(match => match?.[2].startsWith(`${destination}/Contents/`)).map(match => Number(match[1]));
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  if (pids.length) await pause(1000);
}

async function openIsolatedApp(home, destination) {
  const extension = join(home, 'fixture-extension');
  const marker = join(home, 'launched.json');
  await fs.mkdir(extension, { recursive: true });
  await fs.writeFile(join(extension, 'package.json'), JSON.stringify({ name: 'update-launch-fixture', publisher: 'arara-test', version: '1.0.0', engines: { vscode: '^1.134.0' }, activationEvents: ['*'], main: './extension.js' }));
  await fs.writeFile(join(extension, 'extension.js'), `const vscode = require('vscode');
exports.activate = async () => {
  require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ appRoot: vscode.env.appRoot }));
  await vscode.commands.executeCommand('workbench.action.quit');
};
`);
  const args = ['--user-data-dir', join(home, 'profile'), '--extensions-dir', join(home, 'extensions'),
    '--shared-data-dir', join(home, 'shared'), '--agent-plugins-dir', join(home, 'plugins'),
    '--agents-user-data-dir', join(home, 'agents'), '--agents-extensions-dir', join(home, 'agents-extensions'),
    `--extensionDevelopmentPath=${extension}`, '--skip-welcome', '--skip-release-notes', '--disable-telemetry', '--disable-updates'];
  for (const name of ['arara-update', 'arara-ai', 'arara-bot', 'arara-orchestra']) args.push('--disable-extension', `arara.${name}`);
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache') };
  delete env.ELECTRON_RUN_AS_NODE;
  await native('/usr/bin/open', ['-W', '-n', '-a', destination, '--args', ...args], { env, timeout: 90000 });
  assert.equal(JSON.parse(await fs.readFile(marker, 'utf8')).appRoot, join(destination, 'Contents/Resources/app'));
}

async function rejectDifferentSigner(home, destination, options) {
  const payload = join(home, 'other-publisher');
  const app = join(payload, 'Arara Code.app');
  await fs.mkdir(join(app, 'Contents/MacOS'), { recursive: true });
  await fs.writeFile(join(app, 'Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.arara.code</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
  await fs.copyFile('/usr/bin/true', join(app, 'Contents/MacOS/fixture'));
  await native('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  const image = join(home, 'other-publisher.dmg');
  await native('/usr/bin/hdiutil', ['create', '-srcfolder', payload, '-volname', 'Arara Signer Fixture', '-fs', 'HFS+', '-format', 'UDZO', image]);
  await assert.rejects(installMacDmg(image, 'arara-code', options), error => /code failed to satisfy specified code requirement/.test(error.stderr || ''));
  await native('/usr/bin/codesign', ['--verify', '--deep', '--strict', destination]);
  console.log('PASS: a valid ad-hoc signature with the same bundle ID cannot replace the installed publisher');
}

(async () => {
  assert.equal(process.platform, 'darwin', 'Run this integration test on macOS');
  assert.ok(process.env.ARARA_UPDATE_DMG, 'Set ARARA_UPDATE_DMG to a local release DMG');
  const image = resolve(process.env.ARARA_UPDATE_DMG);
  const installed = process.env.ARARA_UPDATE_INSTALLED_APP || '/Applications/Arara Code.app';
  const home = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'arara-mac-auto-')));
  const destination = join(home, 'Applications/Arara Code.app');
  const calls = [];
  const run = async (command, args) => { calls.push([command, args]); return native(command, args); };
  try {
    await fs.mkdir(join(home, 'Applications'));
    await native('/usr/bin/ditto', ['--norsrc', '--noextattr', '--noacl', installed, destination]);
    const signature = await native('/usr/bin/codesign', ['--display', '--requirements', '-', destination]);
    const requirement = macUpdateRequirement(`${signature.stdout}\n${signature.stderr}`, 'arara-code');
    assert.ok(requirement, 'The installed app must have a persistent certificate-bound signature');
    const previous = join(destination, 'Contents/Resources/app/previous-version');
    await fs.writeFile(previous, 'previous');
    const options = { home, appRoot: join(destination, 'Contents/Resources/app'), tmpdir: home, open: false };
    assert.equal(await installMacDmg(image, 'arara-code', options, { execFile: run }), destination);
    await assert.rejects(fs.access(previous));
    assert.ok(!calls.some(([command]) => command.endsWith('spctl')));
    await native('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', destination]);
    await native('/usr/bin/codesign', ['--verify', '--strict', '-R', requirement, destination]);
    console.log('PASS: real release DMG replaces an isolated installed copy after verifying the same signing certificate');
    await rejectDifferentSigner(home, destination, options);
    await openIsolatedApp(home, destination);
    console.log('PASS: LaunchServices opens the updated release with isolated profiles and the real extension host confirms its bundle');
  } finally {
    await stopIsolatedApp(destination);
    await fs.rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
