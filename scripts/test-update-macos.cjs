'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createServer } = require('node:http');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const { once } = require('node:events');
const { join, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { chromium } = require(process.env.PLAYWRIGHT_PATH ? resolve(process.env.PLAYWRIGHT_PATH) : 'playwright');

const native = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = resolve(__dirname, '..');
const app = process.env.ARARA_UPDATE_APP || '/Applications/Arara Code.app';
const source = process.env.ARARA_UPDATE_EXTENSION || join(root, 'extensions/arara-update');

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function runLanguage(work, language, origin) {
  const directory = join(work, language);
  const extension = join(directory, 'extension');
  const events = join(directory, 'events.jsonl');
  await fs.mkdir(extension, { recursive: true });
  await fs.writeFile(events, '');
  await fs.writeFile(join(extension, 'package.json'), JSON.stringify({ name: 'update-flow-fixture', publisher: 'arara-test', version: '1.0.0', engines: { vscode: '^1.134.0' }, activationEvents: ['*'], main: './extension.js' }));
  await fs.writeFile(join(extension, 'extension.js'), `
const vscode = require('vscode');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { registerUpdate } = require(${JSON.stringify(join(source, 'src/register.js'))});
const { UpdateChecker } = require(${JSON.stringify(join(source, 'src/checker.js'))});
const { UpdateDownloads } = require(${JSON.stringify(join(source, 'src/downloads.js'))});
const transport = (url, options) => fetch(${JSON.stringify(origin)} + new URL(url).pathname, options);
class Checker extends UpdateChecker { constructor(options) { super({ ...options, fetchImpl: transport }); } }
class Downloads extends UpdateDownloads { constructor(root, target) { super(root, target, transport); } }
exports.activate = async context => {
await vscode.commands.executeCommand('setContext', 'arara.modal.viewType', undefined);
await vscode.commands.executeCommand('setContext', 'arara.modal.allowedCommands', undefined);
const host = { commands: vscode.commands, window: vscode.window, Uri: vscode.Uri, ExtensionKind: vscode.ExtensionKind, ProgressLocation: vscode.ProgressLocation, env: { appRoot: vscode.env.appRoot, remoteName: vscode.env.remoteName, language: ${JSON.stringify(language)} } };
return registerUpdate(context, host, {
  readFileSync: fs.readFileSync, existsSync: fs.existsSync, mkdir: fsp.mkdir, readdir: fsp.readdir,
  mkdtemp: fsp.mkdtemp, rmdir: fsp.rmdir, tmpdir: () => ${JSON.stringify(directory)},
  spawn, execFile: async (command, args) => {
    const result = await promisify(execFile)(command, args);
    await fsp.appendFile(${JSON.stringify(events)}, JSON.stringify({ command, args }) + '\\n');
    return result;
  },
  homedir: require('node:os').homedir, platform: process.platform, arch: process.arch, env: process.env,
  Checker, Downloads,
});
};
`);
  const profile = join(directory, 'profile');
  const workspace = join(directory, 'workspace');
  await fs.mkdir(workspace);
  const editor = join(workspace, 'update-test.txt');
  await fs.writeFile(editor, 'Arara Code update test\n');
  await fs.mkdir(join(profile, 'User'), { recursive: true });
  await fs.writeFile(join(profile, 'User/settings.json'), JSON.stringify({ 'window.dialogStyle': 'custom', 'window.titleBarStyle': 'custom', 'workbench.startupEditor': 'none', 'telemetry.telemetryLevel': 'off' }));
  const port = await freePort();
  const args = ['--user-data-dir', profile, '--extensions-dir', join(directory, 'extensions'), '--shared-data-dir', join(directory, 'shared'), '--agent-plugins-dir', join(directory, 'plugins'), '--agents-user-data-dir', join(directory, 'agents'), '--agents-extensions-dir', join(directory, 'agents-extensions'), `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--locale=${language}`, `--extensionDevelopmentPath=${extension}`, '--skip-welcome', '--skip-release-notes', '--disable-telemetry', '--disable-updates', '--disable-workspace-trust', workspace, editor];
  for (const name of ['arara-update', 'arara-ai', 'arara-bot', 'arara-orchestra']) args.push('--disable-extension', `arara.${name}`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(join(app, 'Contents/MacOS/Arara Code'), args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  child.stdout.on('data', chunk => output.push(chunk));
  child.stderr.on('data', chunk => output.push(chunk));
  const exited = once(child, 'exit');
  let browser;
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error(Buffer.concat(output).toString());
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
      await delay(500);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0].pages().find(page => page.url().includes('workbench')) || browser.contexts()[0].pages()[0];
    await page.locator('.monaco-editor .view-lines').first().waitFor({ state: 'visible', timeout: 30_000 });
    const button = page.locator('.arara-update-action:not(.disabled) .action-label:visible');
    await page.screenshot({ path: join(directory, 'editor.png') });
    await button.waitFor({ state: 'visible', timeout: 60_000 });
    await button.click();
    const dialog = page.locator('.monaco-dialog-box');
    await dialog.waitFor({ state: 'visible' });
    await page.screenshot({ path: join(directory, 'modal.png') });
    assert.equal(await fs.readFile(events, 'utf8'), '');
    assert.ok((await dialog.innerText()).includes(language === 'en' ? 'After you continue' : language === 'es' ? 'Al continuar' : 'Ao continuar'));
    await dialog.getByRole('button', { name: /^(Cancel|Cancelar)$/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await fs.readFile(events, 'utf8'), '');
    assert.equal(child.exitCode, null);
    await button.click();
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: language === 'en' ? 'Continue' : 'Continuar', exact: true }).click();
    const result = await Promise.race([exited, delay(30_000).then(() => { throw new Error('IDE did not quit after Continue'); })]);
    assert.equal(result[0], 0, Buffer.concat(output).toString());
    const calls = (await fs.readFile(events, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(calls.map(call => call.command), ['/usr/bin/hdiutil', '/usr/bin/open']);
    const mount = calls[0].args[calls[0].args.indexOf('-mountpoint') + 1];
    assert.ok(mount.startsWith(directory + '/'));
    assert.deepEqual(calls[1].args, [mount]);
    assert.equal(await fs.readFile(join(mount, 'Arara Code.app/fixture.txt'), 'utf8'), 'isolated updater fixture');
    console.log(`PASS: ${language} real Update button, localized modal, Cancel, DMG mount, Finder and IDE quit`);
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([exited, delay(5000)]); }
    await browser?.close().catch(() => {});
    await fs.writeFile(join(directory, 'ide.log'), Buffer.concat(output));
    for (const line of (await fs.readFile(events, 'utf8')).trim().split('\n').filter(Boolean)) {
      const call = JSON.parse(line);
      if (call.command !== '/usr/bin/hdiutil' || call.args[0] !== 'attach') continue;
      const mount = call.args[call.args.indexOf('-mountpoint') + 1];
      assert.ok(mount.startsWith(directory + '/'));
      await native('/usr/bin/hdiutil', ['detach', mount]);
      await fs.rmdir(mount);
    }
  }
}

async function main() {
  assert.equal(process.platform, 'darwin', 'This test requires macOS');
  const work = await fs.mkdtemp('/tmp/arara-update-ui-');
  const stage = join(work, 'stage');
  await fs.mkdir(join(stage, 'Arara Code.app'), { recursive: true });
  await fs.writeFile(join(stage, 'Arara Code.app/fixture.txt'), 'isolated updater fixture');
  const image = join(work, 'fixture.dmg');
  await native('/usr/bin/hdiutil', ['create', '-srcfolder', stage, '-volname', 'Arara Update Test', '-fs', 'HFS+', '-format', 'UDZO', image]);
  const payload = await fs.readFile(image);
  const name = 'AraraCode-darwin-universal-9.999.99999.dmg';
  const digest = createHash('sha256').update(payload).digest('hex');
  const server = createServer((request, response) => {
    if (request.url.startsWith('/repos/')) response.end(JSON.stringify([{ tag_name: '9.999.99999', assets: [name, 'SHA256SUMS'].map(name => ({ name, size: payload.length, state: 'uploaded' })) }]));
    else if (request.url.endsWith('/SHA256SUMS')) response.end(`${digest}  ${name}\n`);
    else if (request.url.endsWith('/' + name)) response.end(payload);
    else response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  console.log(`Evidence: ${work}`);
  try {
    for (const language of (process.env.ARARA_UPDATE_LANGUAGES || 'en,pt-br,es').split(',')) await runLanguage(work, language, `http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
