const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const upstream = path.join(root, '.work/vscodium/vscode');
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || path.join(root, '../arara-browser/node_modules/playwright'));
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arara-breakpoints-live-'));
  const fixture = path.join(dir, 'fixture');
  const profile = path.join(dir, 'profile');
  const sample = path.join(dir, 'sample.js');
  await fs.mkdir(fixture);
  await fs.mkdir(path.join(profile, 'User'), { recursive: true });
  await fs.writeFile(path.join(profile, 'User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false, 'update.mode': 'none', 'extensions.autoUpdate': false, 'window.confirmBeforeClose': 'never', 'editor.glyphMargin': true }));
  await fs.mkdir(path.join(profile, 'User/globalStorage'), { recursive: true });
  const { DatabaseSync } = require('node:sqlite');
  const database = new DatabaseSync(path.join(profile, 'User/globalStorage/state.vscdb'));
  database.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
  database.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run('arara.arara-ai', JSON.stringify({ 'arara.setup.v1.completed': true }));
  database.close();
  await fs.writeFile(path.join(dir, 'control.json'), JSON.stringify({ id: 0, mode: 'full' }));
  await fs.writeFile(sample, 'const value = 1;\nconsole.log(value);\n');
  await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'breakpoint-fixture', publisher: 'fixture', version: '0.0.1', engines: { vscode: '^1.100.0' }, main: './extension.js', activationEvents: ['*'], contributes: { debuggers: [{ type: 'fixture', label: 'Fixture', languages: ['javascript'], configurationAttributes: { launch: { properties: {} } } }] } }));
  await fs.writeFile(path.join(fixture, 'extension.js'), `const vscode = require('vscode');
const fs = require('node:fs');
exports.activate = context => {
  const control = ${JSON.stringify(path.join(dir, 'control.json'))};
  const snapshot = ${JSON.stringify(path.join(dir, 'snapshot.json'))};
  let processed = -1;
  const timer = setInterval(async () => {
    const message = JSON.parse(fs.readFileSync(control, 'utf8'));
    if (message.id === processed) return;
    processed = message.id;
    if (message.mode !== 'snapshot') await vscode.commands.executeCommand('setContext', 'arara.ui.hideAdvanced', message.mode === 'optimized');
    fs.writeFileSync(snapshot, JSON.stringify({ id: message.id, breakpoints: vscode.debug.breakpoints.map(item => ({ line: item.location.range.start.line, enabled: item.enabled })) }));
  }, 50);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(${JSON.stringify(sample)}), new vscode.Position(0, 0)))]);
};`);
  const env = { ...process.env, VSCODE_DEV: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.ARARA_ELECTRON_PATH || (process.platform === 'darwin' ? path.join(upstream, '.build/electron/Arara Code.app/Contents/MacOS/Arara Code') : path.join(upstream, '.build/electron/arara-code'));
  let app;
  try {
    app = await electron.launch({ executablePath, cwd: upstream, args: ['.', sample, '--no-sandbox', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-extension=arara.arara-ai', '--disable-extension=arara.arara-bot', '--disable-extension=arara.arara-orchestra', '--logsPath=' + path.join(dir, 'logs'), '--user-data-dir=' + profile, '--extensions-dir=' + path.join(dir, 'extensions'), '--extensionDevelopmentPath=' + fixture], env, timeout: 60000 });
    const page = await app.firstWindow({ timeout: 60000 });
    await page.locator('.monaco-workbench').waitFor();
    let sequence = 0;
    const command = async mode => {
      const id = ++sequence;
      await fs.writeFile(path.join(dir, 'control-next.json'), JSON.stringify({ id, mode }));
      await fs.rename(path.join(dir, 'control-next.json'), path.join(dir, 'control.json'));
      const end = Date.now() + 15000;
      while (Date.now() < end) {
        const result = await fs.readFile(path.join(dir, 'snapshot.json'), 'utf8').then(JSON.parse).catch(() => null);
        if (result?.id === id) return result;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      console.error('FIXTURE LOGS', dir, await page.locator('body').innerText());
      await page.screenshot({ path: path.join(dir, 'failure.png') });
      throw new Error('Fixture did not apply mode ' + mode);
    };
    const glyph = page.locator('.glyph-margin-widgets .codicon-debug-breakpoint');
    await command('full');
    await glyph.first().waitFor({ state: 'visible' }).catch(async error => { console.error(await page.locator('body').innerText()); throw error; });
    for (const mode of ['optimized', 'full', 'optimized', 'full']) {
      await command(mode);
      await glyph.first().waitFor({ state: mode === 'optimized' ? 'hidden' : 'visible' });
      if (mode === 'optimized') {
        const margin = page.locator('.monaco-editor .margin-view-overlays .line-numbers').filter({ hasText: '2' }).first();
        const box = await margin.boundingBox();
        assert.ok(box);
        await page.mouse.move(box.x - 10, box.y + box.height / 2);
        await page.mouse.click(box.x - 10, box.y + box.height / 2);
        assert.equal(await page.locator('.codicon-debug-hint').count(), 0);
      }
      const snapshot = await command('snapshot');
      assert.deepEqual(snapshot.breakpoints, [{ line: 0, enabled: true }]);
    }
    console.log('PASS: real IDE hides breakpoint glyphs, hover and gutter clicks only in optimized mode; saved breakpoint survives repeated switches');
  } finally {
    if (app) app.process().kill('SIGKILL');
    if (!process.env.ARARA_KEEP_BREAKPOINT_FIXTURE) await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
