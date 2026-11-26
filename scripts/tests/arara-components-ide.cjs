'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { setTimeout: delay } = require('node:timers/promises');
const { EXTENSIONS } = require('../extension-layout.cjs');
const { packageComponent } = require('../component-release.cjs');
const { UpdateBusy } = require('../../extensions/arara-update/src/busy');
const { ComponentDownloads } = require('../../extensions/arara-update/src/component-updates');
const { updateComponents } = require('../../extensions/arara-update/src/component-register');

const before = '1.0.0';
const after = '1.0.1';
const runningKey = 'arara.chat.running';
const marker = (dir, name, version) => path.join(dir, `${name}-${version}`);

exports.activate = async vscode => {
  const dir = process.env.ARARA_COMPONENTS_TEST_DIR;
  if (existsSync(path.join(dir, 'started'))) return;
  await fs.writeFile(path.join(dir, 'started'), '');
  try {
    await Promise.all(EXTENSIONS.map(name => vscode.extensions.getExtension(`arara.${name}`).activate()));
    await vscode.commands.executeCommand('setContext', runningKey, true);
    assert.equal(await updateComponents({
      vscode,
      downloads: new ComponentDownloads(path.join(dir, 'downloads')),
      busy: new UpdateBusy(() => {}),
      ideVersion: vscode.version,
      ideUpdateReady: () => false,
      signal: new AbortController().signal,
    }), 'restarting');
    await delay(1200);
    for (const name of EXTENSIONS) assert.equal(existsSync(marker(dir, name, after)), false);
    await fs.writeFile(path.join(dir, 'finished'), '');
    await vscode.commands.executeCommand('setContext', runningKey, false);
  } catch (error) {
    await fs.writeFile(path.join(dir, 'error'), error.stack);
  }
};

async function writeExtension(folder, name, version, source, contributes) {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({
    publisher: 'arara', name, version, engines: { vscode: '^1.0.0' }, main: './main.cjs',
    activationEvents: ['onStartupFinished'], contributes,
  }));
  await fs.writeFile(path.join(folder, 'main.cjs'), source);
}

async function main() {
  const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || '../../../arara-browser/node_modules/playwright');
  const source = path.resolve(__dirname, '../../.work/vscodium/vscode');
  const product = require(path.join(source, 'product.json'));
  assert.equal(product.quality, 'stable');
  const executable = process.platform === 'darwin'
    ? path.join(product.nameLong + '.app', 'Contents/MacOS', product.nameShort)
    : process.platform === 'win32' ? product.nameShort + '.exe' : product.applicationName;
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'arara-components-ide-'));
  let app;
  let server;
  try {
    const builtins = path.join(dir, 'builtins');
    const user = path.join(dir, 'profile', 'User');
    const globalStorage = path.join(user, 'globalStorage');
    await fs.mkdir(globalStorage, { recursive: true });
    const { extensionId, completedKey } = product.startupWebview;
    const database = new DatabaseSync(path.join(globalStorage, 'state.vscdb'));
    try {
      database.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
      database.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(extensionId, JSON.stringify({ [completedKey]: true }));
    } finally {
      database.close();
    }
    const packages = new Map();
    for (const [index, name] of EXTENSIONS.entries()) {
      for (const [folder, version] of [[path.join(builtins, name), before], [path.join(dir, name), after]]) {
        await writeExtension(folder, name, version, `exports.activate = () => require('node:fs').writeFileSync(${JSON.stringify(marker(dir, name, version))}, String(process.pid));`);
      }
      const vsix = path.join(dir, `${name}.vsix`);
      packages.set(`/v1/ide/components/download/${String(index).repeat(43)}`, { ...packageComponent(name, path.join(dir, name), vsix), bytes: await fs.readFile(vsix) });
    }
    await writeExtension(path.join(builtins, 'fixture'), 'component-update-fixture', before,
      `exports.activate = () => require(${JSON.stringify(__filename)}).activate(require('vscode'));`,
      { configuration: { properties: { 'arara.apiUrl': { type: 'string' } } } });
    server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/v1/ide/version') {
        assert.equal(url.searchParams.get('components'), EXTENSIONS.map(name => `${name}@${before}`).join(','));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ updateAvailable: false, components: [...packages].map(([url, { name, engine, version, sha256, size }]) => ({
          name, engine, latest: version, updateAvailable: true, download: { url, sha256, size },
        })) }));
        return;
      }
      const entry = packages.get(url.pathname);
      if (entry) res.end(entry.bytes);
      else res.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({
      'arara.apiUrl': `http://127.0.0.1:${server.address().port}`, 'extensions.autoUpdate': 'off',
      'extensions.autoCheckUpdates': false, 'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
    }));
    const home = path.join(dir, 'home');
    await fs.mkdir(home);
    const inherit = ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'];
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => inherit.includes(key)));
    Object.assign(env, { HOME: home, USERPROFILE: home, VSCODE_DEV: '1', NODE_ENV: 'development', ARARA_COMPONENTS_TEST_DIR: dir });
    app = await electron.launch({
      executablePath: process.env.ARARA_ELECTRON_PATH || path.join(source, '.build/electron', executable),
      cwd: source, env,
      args: ['.', '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--locale=en',
        `--user-data-dir=${path.dirname(user)}`, `--extensions-dir=${path.join(dir, 'user-extensions')}`, `--builtin-extensions-dir=${builtins}`],
    });
    const deadline = Date.now() + 30_000;
    while (!EXTENSIONS.every(name => existsSync(marker(dir, name, after)))) {
      if (existsSync(path.join(dir, 'error'))) assert.fail(await fs.readFile(path.join(dir, 'error'), 'utf8'));
      assert.ok(Date.now() < deadline, 'Updated extensions did not activate before the timeout');
      await delay(100);
    }
    assert.ok(existsSync(path.join(dir, 'finished')));
    for (const name of EXTENSIONS) {
      assert.notEqual(await fs.readFile(marker(dir, name, before), 'utf8'), await fs.readFile(marker(dir, name, after), 'utf8'), name);
    }
    console.log('PASS: stable IDE installs three built-in VSIX updates and activates them in a new host after the running chat finishes.');
  } catch (error) {
    const logs = path.join(dir, 'profile', 'logs');
    for (const file of await fs.readdir(logs, { recursive: true }).catch(() => [])) {
      if (!/(exthost|renderer|sharedprocess)\.log$/.test(file)) continue;
      const log = await fs.readFile(path.join(logs, file), 'utf8');
      console.error(log.split('\n').filter(line => /extension host|component|\.vsix|error|installExtension|restartExtensions/i.test(line)).slice(-15).join('\n'));
    }
    throw error;
  } finally {
    await app?.close();
    server?.closeAllConnections();
    server?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
