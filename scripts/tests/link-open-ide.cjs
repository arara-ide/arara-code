const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const upstream = path.join(root, '.work/vscodium/vscode');
const link = 'https://example.com/arara-link-test?from=ide#top';

const extensionTest = `const fs = require('node:fs');
const vscode = require('vscode');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.run = async () => {
  await delay(8000);
  const started = Date.now();
  const opening = vscode.env.openExternal(vscode.Uri.parse(process.env.ARARA_LINK_URL, true)).then(value => value, error => 'error: ' + error.message);
  const opened = await Promise.race([opening, delay(15000).then(() => 'timeout')]);
  let recorded = '';
  for (let i = 0; i < 100 && !recorded.includes(process.env.ARARA_LINK_URL); i++) {
    await delay(100);
    try { recorded = fs.readFileSync(process.env.ARARA_LINK_OPENED, 'utf8'); } catch {}
  }
  fs.writeFileSync(process.env.ARARA_LINK_RESULT, JSON.stringify({ opened, recorded, ms: Date.now() - started }));
  if (opened !== true || !recorded.includes(process.env.ARARA_LINK_URL)) throw new Error('link did not open directly');
};
`;

function overlayInSync() {
  const overlay = JSON.parse(fs.readFileSync(path.join(root, 'branding/product.overlay.json'), 'utf8'));
  const product = JSON.parse(fs.readFileSync(path.join(upstream, 'product.json'), 'utf8'));
  assert.deepEqual(product.linkProtectionTrustedDomains, overlay.linkProtectionTrustedDomains,
    'the prepared IDE is older than branding/product.overlay.json: run scripts/prepare.sh --skip-source');
  return product;
}

function run(directory, product) {
  const write = (file, value, mode) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, { mode }); return file; };
  const opened = path.join(directory, 'opened.txt');
  const browser = write(path.join(directory, 'browser.sh'), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${opened}'\n`, 0o755);
  const extension = path.join(directory, 'extension');
  write(path.join(extension, 'package.json'), JSON.stringify({ name: 'arara-link-test', publisher: 'arara-test', version: '0.0.1', engines: { vscode: '*' } }));
  write(path.join(extension, 'test.cjs'), extensionTest);
  write(path.join(directory, 'data/User/settings.json'), JSON.stringify({ 'workbench.externalBrowser': browser, 'workbench.startupEditor': 'none', 'window.dialogStyle': 'native' }));
  fs.mkdirSync(path.join(directory, 'workspace'));
  const result = path.join(directory, 'result.json');
  const electron = path.join(upstream, '.build/electron', product.applicationName);
  const args = ['-a', electron, '.', '--no-sandbox', '--disable-gpu', '--disable-extensions', '--skip-welcome', '--skip-release-notes',
    '--user-data-dir', path.join(directory, 'data'), '--extensions-dir', path.join(directory, 'extensions'),
    `--extensionDevelopmentPath=${extension}`, `--extensionTestsPath=${path.join(extension, 'test.cjs')}`, path.join(directory, 'workspace')];
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(VSCODE_|ELECTRON_|WAYLAND_DISPLAY$)/.test(name)));
  const env = { ...inherited, HOME: directory, VSCODE_DEV: '1', NODE_ENV: 'development', VSCODE_CLI: '1', ARARA_LINK_URL: link, ARARA_LINK_OPENED: opened, ARARA_LINK_RESULT: result };
  return new Promise(resolve => {
    const child = spawn('xvfb-run', args, { cwd: upstream, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let log = '';
    child.stdout.on('data', chunk => { log += chunk; });
    child.stderr.on('data', chunk => { log += chunk; });
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 90000);
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, log, result: fs.existsSync(result) ? JSON.parse(fs.readFileSync(result, 'utf8')) : undefined });
    });
  });
}

(async () => {
  execFileSync('xvfb-run', ['--help'], { stdio: 'ignore' });
  const product = overlayInSync();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-link-open-ide-'));
  try {
    const { code, log, result } = await run(directory, product);
    assert.ok(result, `the IDE did not run the test (exit ${code}):\n${log.slice(-2000)}`);
    assert.equal(result.opened, true, 'openExternal must resolve without waiting for a dialog');
    assert.equal(result.recorded.trim(), link, 'the configured browser must receive the exact link');
    assert.equal(code, 0, log.slice(-2000));
    console.log(`PASS: the real IDE opened ${link} in the browser in ${result.ms} ms, without the Open/Copy/Configure dialog (isolated profile, xvfb).`);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
