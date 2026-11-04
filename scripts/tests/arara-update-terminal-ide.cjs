const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const wait = async (check, label, timeout = 45000) => {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    assert.ok(Date.now() < deadline, label);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};

exports.run = async () => {
  const vscode = require('vscode');
  const { registerUpdate } = require('../../extensions/arara-update/src/register');
  const directory = process.env.ARARA_UPDATE_TERMINAL_TEST;
  assert.ok(directory);
  const subscriptions = [];
  const stage = value => fs.appendFile(path.join(directory, 'stages'), value + '\n');
  await stage('started');
  let onUpdate;
  const ready = { version: '1.135.99999', file: path.join(directory, 'installer.deb') };
  const platform = Object.create(vscode, { window: { value: Object.create(vscode.window, { createTerminal: { value: options => vscode.window.createTerminal({ ...options,
    env: { PATH: `${path.join(directory, 'bin')}${path.delimiter}/usr/bin:/bin`, ARARA_UPDATE_TERMINAL_TEST: directory },
  }) } }) } });
  const checker = registerUpdate({ subscriptions, extension: { extensionKind: vscode.ExtensionKind.UI }, globalStorageUri: vscode.Uri.file(directory) }, platform, {
    platform: 'linux', arch: 'x64', readFileSync: () => JSON.stringify({ version: '1.135.00001' }), existsSync: () => true,
    homedir: () => path.join(directory, 'home'),
    Checker: class {
      constructor(options) { onUpdate = options.onUpdate; }
      start() {} dispose() {} async latest() { return null; }
    },
    Downloads: class { async prepare() { return ready; } async cached() { return ready; } async startup() {} },
  });
  assert.ok(checker);
  const originalTerminals = [...vscode.window.terminals];
  try {
    await onUpdate({ latest: ready.version, current: '1.135.00001' });
    const closed = new Set();
    subscriptions.push(vscode.window.onDidCloseTerminal(terminal => closed.add(terminal)));
    await stage('prepared');
    await vscode.commands.executeCommand('arara.update.open');
    await stage('opened');
    await wait(() => vscode.window.terminals.some(terminal => !originalTerminals.includes(terminal)), 'Update terminal did not open');
    const terminal = vscode.window.terminals.find(terminal => !originalTerminals.includes(terminal));
    await stage('terminal-visible');
    await wait(() => closed.has(terminal), 'Update terminal stayed open after installing');
    const args = await fs.readFile(path.join(directory, 'arguments'), 'utf8');
    assert.equal(args, `apt\ninstall\n${ready.file}\n`);
    assert.equal(vscode.window.terminals.includes(terminal), false);
    await fs.writeFile(path.join(directory, 'passed'), '');
  } catch (error) {
    await fs.writeFile(path.join(directory, 'error'), String(error.stack || error));
    throw error;
  } finally {
    for (const subscription of subscriptions.reverse()) subscription.dispose();
  }
};

async function main() {
  const root = path.resolve(__dirname, '../..');
  const { _electron } = require(process.env.PLAYWRIGHT_PATH || path.resolve(root, '../ac-web/node_modules/playwright'));
  const directory = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'arara-update-terminal-'));
  const fixture = path.join(directory, 'fixture');
  await fs.mkdir(fixture);
  await fs.mkdir(path.join(directory, 'bin'));
  await fs.mkdir(path.join(directory, 'home'));
  await fs.mkdir(path.join(directory, 'profile', 'User'), { recursive: true });
  await fs.writeFile(path.join(directory, 'profile', 'User', 'arara.setup.v1.completed'), 'true\n');
  await fs.writeFile(path.join(directory, 'profile', 'User', 'settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false, 'update.mode': 'none',
    'telemetry.telemetryLevel': 'off', 'terminal.integrated.shellIntegration.enabled': false,
  }));
  await fs.writeFile(path.join(directory, 'bin', 'sudo'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$ARARA_UPDATE_TERMINAL_TEST/arguments"\nexit 0\n', { mode: 0o700 });
  await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'update-terminal-fixture', publisher: 'arara', version: '0.0.1', engines: { vscode: '^1.100.0' }, main: './extension.cjs' }));
  await fs.writeFile(path.join(fixture, 'extension.cjs'), 'exports.activate = () => {};');
  const source = path.join(root, '.work/vscodium/vscode');
  const developmentExecutable = path.join(source, '.build/electron/Arara Code.app/Contents/MacOS/Arara Code');
  const executablePath = process.env.ARARA_ELECTRON_PATH || (process.platform === 'darwin' ? developmentExecutable : '/usr/share/arara-code/arara-code');
  const development = executablePath.includes('/.work/');
  const env = { ...process.env, HOME: path.join(directory, 'home'), USERPROFILE: path.join(directory, 'home'), ARARA_UPDATE_TERMINAL_TEST: directory,
    PATH: `${path.join(directory, 'bin')}${path.delimiter}${process.env.PATH}` };
  if (development) Object.assign(env, { VSCODE_DEV: '1', VSCODE_SKIP_PRELAUNCH: '1', NODE_ENV: 'development' });
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const watchdog = setTimeout(() => { app?.process().kill('SIGTERM'); process.exitCode = 1; }, 100000);
  try {
    app = await _electron.launch({ executablePath, cwd: development ? source : root, env, timeout: 45000, args: [
      ...(development ? ['.'] : []), '--new-window', '--no-sandbox', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--locale=en',
      '--disable-extension=arara.arara-ai', '--disable-extension=arara.arara-bot', '--disable-extension=arara.arara-orchestra', '--disable-extension=arara.arara-update',
      `--user-data-dir=${path.join(directory, 'profile')}`, `--extensions-dir=${path.join(directory, 'extensions')}`,
      `--extensionDevelopmentPath=${fixture}`, `--extensionTestsPath=${__filename}`,
    ] });
    for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', data => { void fs.appendFile(path.join(directory, 'editor.log'), data); });
    const exited = new Promise((resolve, reject) => { app.process().once('exit', resolve); app.process().once('error', reject); });
    await exited;
    await fs.access(path.join(directory, 'passed'));
    console.log('PASS: real IDE opens the update terminal, runs the isolated installer and closes that terminal immediately after success without restarting the IDE');
  } finally {
    clearTimeout(watchdog);
    await app?.close().catch(() => undefined);
    console.log(`Artifacts: ${directory}`);
  }
}

if (require.main === module) void main().catch(error => { console.error(error); process.exitCode = 1; });
