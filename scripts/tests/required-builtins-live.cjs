const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { stageExtension } = require('../extension-layout.cjs');
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || '../../../arara-browser/node_modules/playwright');

const root = path.resolve(__dirname, '../..');
const source = path.join(root, '.work/vscodium/vscode');
const product = require(path.join(source, 'product.json'));
const required = require('../../branding/product.overlay.json').requiredBuiltinExtensions;
const mac = process.platform === 'darwin';
const modifier = mac ? 'Meta' : 'Control';
const executable = mac ? path.join(product.nameLong + '.app', 'Contents/MacOS', product.nameShort)
  : process.platform === 'win32' ? product.nameShort + '.exe' : product.applicationName;

async function verify(directory, legacy) {
  const profile = path.join(directory, legacy ? 'legacy' : 'fresh');
  const storage = path.join(profile, 'User/globalStorage');
  fs.mkdirSync(storage, { recursive: true });
  fs.writeFileSync(path.join(profile, 'User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'extensions.autoUpdate': false, 'update.mode': 'none' }));
  const database = new DatabaseSync(path.join(storage, 'state.vscdb'));
  try {
    database.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
    const insert = database.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)');
    insert.run('arara.arara-ai', JSON.stringify({ 'arara.setup.v1.completed': true }));
    if (legacy) insert.run('extensionsIdentifiers/disabled', JSON.stringify(required.map(id => ({ id }))));
  } finally {
    database.close();
  }
  const env = { ...process.env, VSCODE_DEV: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: process.env.ARARA_ELECTRON_PATH || path.join(source, '.build/electron', executable),
    cwd: source, env, args: ['.', path.join(directory, 'workspace'), '--locale=en', '--skip-welcome', '--skip-release-notes',
      '--disable-workspace-trust', '--user-data-dir=' + profile, '--extensions-dir=' + path.join(directory, 'user-extensions'),
      '--builtin-extensions-dir=' + path.join(directory, 'builtins')],
  });
  try {
    const page = await app.firstWindow();
    const launcher = page.locator('.part.titlebar .arara-title-text-launcher').filter({ hasText: /^Orchestra$/ });
    await launcher.click({ timeout: 60000 });
    await page.locator('.tabs-container .tab').filter({ hasText: 'Orchestra' }).first().waitFor();
    await page.getByRole('tab', { name: /^Extensions/ }).first().click();
    for (const id of required) {
      const search = page.locator('.extensions-search-container .monaco-editor');
      await search.click();
      await page.keyboard.press(modifier + '+a');
      await page.keyboard.insertText('@id:' + id);
      const row = page.locator('[data-extension-id="' + id + '"]');
      const name = await row.locator('.name').first().innerText();
      await row.click();
      const editor = page.locator('.extension-editor:visible');
      await editor.getByRole('heading', { name, exact: true }).waitFor();
      await editor.getByText('This extension is enabled because it is required in the current environment.', { exact: false }).waitFor();
      assert.equal(await editor.getByRole('button', { name: /^Disable( \(Workspace\))?$/ }).count(), 0, id);
    }
    console.log('PASS: Orchestra opens and both required extensions are locked in the ' + (legacy ? 'legacy' : 'fresh') + ' profile.');
  } catch (error) {
    const page = await app.firstWindow();
    console.error((await page.locator('.monaco-workbench').innerText()).slice(0, 3000));
    throw error;
  } finally {
    await app.close();
  }
}

(async () => {
  assert.deepEqual(product.requiredBuiltinExtensions, required, 'Prepare the IDE with the current product overlay.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-required-builtins-'));
  try {
    fs.mkdirSync(path.join(directory, 'workspace'));
    for (const id of required) {
      const name = id.split('.')[1];
      stageExtension(name, path.resolve(root, '..', name), path.join(directory, 'builtins', name), 'local');
    }
    await verify(directory, false);
    await verify(directory, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
