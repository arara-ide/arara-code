const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const upstream = path.join(root, '.work/vscodium/vscode');
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || path.join(root, '../arara-browser/node_modules/playwright'));

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arara-statusbar-live-'));
  const fixture = path.join(dir, 'fixture');
  const profile = path.join(dir, 'profile');
  await fs.mkdir(fixture);
  await fs.mkdir(path.join(profile, 'User'), { recursive: true });
  await fs.writeFile(path.join(profile, 'User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false, 'update.mode': 'none', 'extensions.autoUpdate': false, 'window.confirmBeforeClose': 'never' }));
  await fs.writeFile(path.join(dir, 'sample.txt'), 'first\nsecond\n');
  await fs.mkdir(path.join(profile, 'User/globalStorage'), { recursive: true });
  const { DatabaseSync } = require('node:sqlite');
  const database = new DatabaseSync(path.join(profile, 'User/globalStorage/state.vscdb'));
  database.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
  database.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run('arara.arara-ai', JSON.stringify({ 'arara.setup.v1.completed': true }));
  database.close();

  const commands = ['optimized', 'full', 'formatter'].map(mode => ({ command: `fixture.${mode}`, title: `Fixture ${mode}` }));
  await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'prettier-vscode', publisher: 'esbenp', version: '0.0.1', engines: { vscode: '^1.100.0' }, main: './extension.js', activationEvents: ['*'], contributes: { commands } }));
  await fs.writeFile(path.join(fixture, 'extension.js'), `const vscode = require('vscode');
exports.activate = context => {
  for (const mode of ['optimized', 'full']) context.subscriptions.push(vscode.commands.registerCommand('fixture.' + mode, () => vscode.commands.executeCommand('setContext', 'arara.ui.hideAdvanced', mode === 'optimized')));
  context.subscriptions.push(vscode.commands.registerCommand('fixture.formatter', () => {
    const item = vscode.window.createStatusBarItem('prettier.status', vscode.StatusBarAlignment.Right);
    item.text = 'Prettier'; item.show(); context.subscriptions.push(item);
  }));
};`);
  const env = { ...process.env, VSCODE_DEV: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ executablePath: process.env.ARARA_ELECTRON_PATH || path.join(upstream, '.build/electron/arara-code'), cwd: upstream, args: ['.', path.join(dir, 'sample.txt'), '--no-sandbox', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-extension=arara.arara-ai', '--disable-extension=arara.arara-bot', '--disable-extension=arara.arara-orchestra', '--logsPath=' + path.join(dir, 'logs'), '--user-data-dir=' + profile, '--extensions-dir=' + path.join(dir, 'extensions'), '--extensionDevelopmentPath=' + fixture], env, timeout: 60000 });
    const page = await app.firstWindow({ timeout: 60000 });
    await page.locator('.part.statusbar').waitFor().catch(async error => { console.error(await page.locator('body').innerText()); throw error; });
    const command = async mode => {
      await page.keyboard.press('Control+Shift+P');
      await page.locator('.quick-input-widget input').fill('>Fixture ' + mode);
      await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Fixture ' + mode }).first().click().catch(async error => { console.error('FIXTURE LOGS', dir, await page.locator('.quick-input-widget').innerText()); throw error; });
      await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });
    };
    const ids = ['status.editor.mode', 'status.editor.eol', 'status.editor.encoding', 'status.editor.indentation', 'status.editor.selection'];
    const entry = id => page.locator('.part.statusbar .statusbar-item[id="' + id + '"]');
    for (const id of ids) await entry(id).waitFor({ state: 'visible' });
    await command('optimized');
    for (const id of ids) await entry(id).waitFor({ state: 'hidden' });
    await command('formatter');
    const formatter = entry('esbenp.prettier-vscode.prettier.status');
    await formatter.waitFor({ state: 'attached' });
    assert.equal(await formatter.isVisible(), false, 'late formatter entries stay hidden');
    for (const mode of ['full', 'optimized', 'full']) {
      await command(mode);
      for (const id of [...ids, 'esbenp.prettier-vscode.prettier.status']) await entry(id).waitFor({ state: mode === 'full' ? 'visible' : 'hidden' });
    }
    await page.locator('.monaco-editor textarea').first().focus();
    await page.keyboard.press('Control+g');
    await page.locator('.quick-input-widget input').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    console.log('PASS: real editor metadata, late formatter entry, repeated optimized/full changes and Go to Line command');
  } finally {
    if (app) app.process().kill('SIGKILL');
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
