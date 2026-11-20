const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildExtension } = require('../extension-layout.cjs');
const { findInstallation, installCandidates, parseArgs, updateInstalled } = require('../update-installed.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara update installed '));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const read = file => fs.readFileSync(file, 'utf8');

try {
  const workspace = path.join(dir, 'workspace');
  const ai = path.join(workspace, 'arara-ai');
  write(path.join(ai, 'package.json'), JSON.stringify({
    publisher: 'arara', name: 'arara-ai', enabledApiProposals: ['quickPickSortByLabel', 'environmentPower'],
    devDependencies: { esbuild: '1' }, scripts: { build: 'x' },
    contributes: { configuration: { properties: { 'arara.apiUrl': { description: '%apiUrl%' }, 'arara.webUrl': {} } } },
  }));
  for (const [file, text] of Object.entries({ 'package.nls.json': '{}', 'package.nls.pt-br.json': '{}', 'dist/extension.js': 'new ai', 'dist/extension.js.map': '{}', 'media/task-list.cjs': 'tasks', 'themes/t.json': '{}', 'src/x.ts': 'source' })) write(path.join(ai, file), text);
  const orch = path.join(workspace, 'arara-orchestra');
  for (const [file, text] of Object.entries({ 'package.json': '{"name":"arara-orchestra"}', 'dist/extension.js': 'new orch', 'dist/webview/webview.js': 'view', 'media/o.css': 'css' })) write(path.join(orch, file), text);
  const bot = path.join(workspace, 'arara-bot');
  write(path.join(bot, 'package.json'), '{}');
  for (const [file, text] of Object.entries({ 'package.json': '{"name":"arara-bot"}', LICENSE: 'L', NOTICE: 'N', 'dist/extension.js': 'e', 'dist/hub.js': 'h', 'dist/bridge.js': 'b', 'dist/webview.js': 'w', 'media/m.svg': 's', 'server/index.js': 'srv', 'skills/a/SKILL.md': '#' })) write(path.join(bot, 'extension', file), text);

  const install = path.join(dir, 'Arara Code.app');
  const app = path.join(install, 'Contents', 'Resources', 'app');
  write(path.join(app, 'product.json'), JSON.stringify({ nameShort: 'Arara Code', extensionEnabledApiProposals: { 'arara.arara-ai': ['quickPickSortByLabel'], other: ['x'] } }));
  write(path.join(app, 'extensions/arara-ai/dist/extension.js'), 'old ai');
  write(path.join(app, 'extensions/arara-ai/obsolete.js'), 'old');
  write(path.join(app, 'extensions/arara-orchestra/dist/extension.js'), 'old orch');
  write(path.join(app, 'extensions/vscode.git/package.json'), '{}');

  const real = fs.realpathSync.native(app);
  assert.equal(findInstallation(install), real);
  assert.equal(findInstallation(path.join(install, 'Contents')), real);
  assert.equal(findInstallation(app), real);
  const linuxInstall = path.join(dir, 'opt', 'arara-code');
  const linuxApp = path.join(linuxInstall, 'resources', 'app');
  write(path.join(linuxApp, 'product.json'), '{}');
  fs.mkdirSync(path.join(linuxApp, 'extensions'));
  assert.equal(findInstallation(linuxInstall), fs.realpathSync.native(linuxApp));
  assert.throws(() => findInstallation(path.join(dir, 'missing')), /No Arara Code installation/);
  assert.throws(() => findInstallation(undefined, [path.join(dir, 'nowhere')]), /--app <path>/);
  assert.ok(installCandidates('darwin', '/Users/u').includes('/Applications/Arara Code.app/Contents/Resources/app'));
  assert.ok(installCandidates('linux', '/home/u').includes('/usr/share/arara-code/resources/app'));
  assert.ok(installCandidates('win32', 'C:\\Users\\u', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' }).some(item => item.includes('Programs') && item.endsWith(path.join('resources', 'app'))));

  assert.deepEqual(parseArgs(['--only', 'ai,orchestra', '--skip-build']).only, ['arara-ai', 'arara-orchestra']);
  assert.throws(() => parseArgs(['--only', 'vibes']), /--only accepts/);
  assert.throws(() => parseArgs(['--environment', 'staging']), /production or local/);
  assert.throws(() => parseArgs(['--app']), /needs a value/);
  assert.throws(() => parseArgs(['--force']), /Unknown option/);

  const quiet = () => {};
  const built = [];
  const dry = updateInstalled({ ...parseArgs(['--app', install, '--workspace', workspace, '--dry-run']), backupDir: path.join(dir, 'backups') }, quiet, name => built.push(name));
  assert.deepEqual(built, ['arara-ai', 'arara-bot', 'arara-orchestra']);
  assert.deepEqual(dry.updated, []);
  assert.equal(read(path.join(app, 'extensions/arara-ai/dist/extension.js')), 'old ai');
  assert.ok(!fs.existsSync(path.join(dir, 'backups')));

  const result = updateInstalled({ ...parseArgs(['--app', install, '--workspace', workspace, '--skip-build', '--only', 'ai,orchestra']), backupDir: path.join(dir, 'backups') }, quiet, () => assert.fail('must not build'));
  assert.deepEqual(result.updated, ['arara-ai', 'arara-orchestra']);
  assert.equal(read(path.join(app, 'extensions/arara-ai/dist/extension.js')), 'new ai');
  assert.equal(read(path.join(app, 'extensions/arara-ai/media/task-list.cjs')), 'tasks');
  assert.ok(!fs.existsSync(path.join(app, 'extensions/arara-ai/obsolete.js')), 'stale files are removed');
  assert.ok(!fs.existsSync(path.join(app, 'extensions/arara-ai/src')), 'sources stay out');
  assert.ok(!fs.existsSync(path.join(app, 'extensions/arara-ai/dist/extension.js.map')));
  const manifest = JSON.parse(read(path.join(app, 'extensions/arara-ai/package.json')));
  assert.equal(manifest.araraEnvironment, 'production');
  assert.equal(manifest.scripts, undefined);
  assert.equal(read(path.join(app, 'extensions/arara-orchestra/dist/webview/webview.js')), 'view');
  assert.ok(!fs.existsSync(path.join(app, 'extensions/arara-bot')), '--only leaves other extensions alone');
  assert.ok(fs.existsSync(path.join(app, 'extensions/vscode.git/package.json')));
  assert.equal(read(path.join(result.backup, 'arara-ai/dist/extension.js')), 'old ai');
  assert.equal(read(path.join(result.backup, 'arara-ai/obsolete.js')), 'old');
  assert.equal(read(path.join(result.backup, 'arara-orchestra/dist/extension.js')), 'old orch');
  assert.deepEqual(result.proposals, ['environmentPower']);
  const product = JSON.parse(read(path.join(app, 'product.json')));
  assert.deepEqual(product.extensionEnabledApiProposals, { 'arara.arara-ai': ['quickPickSortByLabel', 'environmentPower'], other: ['x'] });
  assert.deepEqual(JSON.parse(read(path.join(result.backup, 'product.json'))).extensionEnabledApiProposals['arara.arara-ai'], ['quickPickSortByLabel']);
  assert.equal(fs.readdirSync(path.join(app, 'extensions')).filter(name => name.includes('.arara-next')).length, 0);

  const again = updateInstalled({ ...parseArgs(['--app', install, '--workspace', workspace, '--skip-build', '--only', 'ai']), backupDir: path.join(dir, 'backups') }, quiet);
  assert.deepEqual(again.proposals, [], 'proposals are added once');

  fs.rmSync(path.join(orch, 'dist/webview/webview.js'));
  assert.throws(() => updateInstalled({ ...parseArgs(['--app', install, '--workspace', workspace, '--skip-build', '--only', 'orchestra']), backupDir: path.join(dir, 'backups') }, quiet), /missing release files: dist\/webview\/webview.js/);
  assert.equal(read(path.join(app, 'extensions/arara-orchestra/dist/webview/webview.js')), 'view', 'a broken build never reaches the installation');

  const calls = [];
  const spawn = (command, args, options) => { calls.push([path.relative(workspace, options.cwd), command, ...args]); return { status: 0 }; };
  fs.mkdirSync(path.join(bot, 'node_modules'), { recursive: true });
  buildExtension('arara-bot', bot, spawn);
  assert.deepEqual(calls, [
    ['arara-bot', 'pnpm', 'build:server'],
    [path.join('arara-bot', 'extension'), 'npm', 'ci', '--no-audit', '--no-fund'],
    [path.join('arara-bot', 'extension'), 'npm', 'run', '--silent', 'build'],
    [path.join('arara-bot', 'extension'), 'npm', 'run', '--silent', 'stage'],
  ]);
  assert.throws(() => buildExtension('arara-ai', ai, () => ({ status: 2 })), /npm ci --no-audit --no-fund failed/);
  console.log('PASS: update-installed finds the installation, backs up, replaces only built release files, checks SHA-256, enables API proposals and refuses broken builds.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
