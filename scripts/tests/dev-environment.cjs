const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara dev environment '));
const code = path.join(dir, 'arara-code');
const extension = path.join(dir, 'arara-ai');
const upstream = path.join(code, '.work/vscodium/vscode');
const write = (file, text, mode) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, mode ? { mode } : undefined); };
try {
  for (const script of ['dev.sh', 'apply-environment.cjs']) write(path.join(code, 'scripts', script), fs.readFileSync(path.join(root, 'scripts', script)));
  for (const script of ['sync-dev-patches.sh', 'default-extensions.sh']) write(path.join(code, 'scripts', script), '#!/bin/bash\nexit 0\n');
  write(path.join(code, 'scripts/prepare-language-detection.cjs'), '');
  write(path.join(code, 'extensions/arara-update/package.json'), '{}');
  write(path.join(dir, 'bin/npm'), '#!/bin/bash\nexit 0\n', 0o755);
  write(path.join(upstream, 'product.json'), JSON.stringify({ applicationName: 'arara-code' }));
  write(path.join(upstream, '.build/electron/arara-code'), '#!/bin/bash\nexit 0\n', 0o755);
  write(path.join(upstream, 'extensions/git/out/main.js'), '// built');
  for (const prefix of ['src', 'out']) write(path.join(upstream, prefix, 'vs/base/browser/ui/codicons/codicon/codicon.ttf'), 'font');
  for (const folder of [path.join(upstream, 'node_modules'), path.join(extension, 'node_modules')]) fs.mkdirSync(folder, { recursive: true });
  const manifest = fs.readFileSync(path.join(root, '../arara-ai/package.json'), 'utf8');
  write(path.join(extension, 'package.json'), manifest);
  for (const folder of ['dist', 'media', 'themes']) write(path.join(extension, folder, 'fixture'), 'fixture');
  const capture = path.join(dir, 'arguments.txt');
  write(path.join(upstream, 'scripts/code.sh'), '#!/bin/bash\n[ -z "${ELECTRON_RUN_AS_NODE:-}${VSCODE_IPC_HOOK:-}${VSCODE_CWD:-}${VSCODE_PID:-}" ] || exit 42\nprintf "%s\\n" "$@" > "$CAPTURE"\n', 0o755);
  const env = { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, CAPTURE: capture, ARARA_AI_DIR: extension, ELECTRON_RUN_AS_NODE: '1', VSCODE_IPC_HOOK: '/tmp/parent.sock', VSCODE_CWD: '/', VSCODE_PID: '99999' };
  delete env.ARARA_DEV_PROFILE;
  const launch = args => { execFileSync('bash', [path.join(code, 'scripts/dev.sh'), ...args], { env, stdio: 'pipe' }); return fs.readFileSync(capture, 'utf8').trim().split('\n'); };
  const productionProfile = path.join(code, '.work/dev-profile-production');
  const localProfile = path.join(code, '.work/dev-profile');
  write(path.join(localProfile, 'keep'), 'local'); write(path.join(productionProfile, 'remove'), 'old');
  const args = launch(['--reset', '--no-sandbox', '--production', '/project with spaces']);
  assert.ok(args.includes('--no-sandbox')); assert.ok(args.includes('/project with spaces'));
  assert.ok(!args.includes('--production')); assert.ok(!args.includes('--reset'));
  assert.equal(args[args.indexOf('--user-data-dir') + 1], path.join(productionProfile, 'data'));
  assert.ok(fs.existsSync(path.join(localProfile, 'keep'))); assert.ok(!fs.existsSync(path.join(productionProfile, 'remove')));
  const staged = args.find(arg => arg.startsWith('--extensionDevelopmentPath=')).split('=')[1];
  assert.ok(args.includes(`--extensionDevelopmentPath=${path.join(code, 'extensions/arara-update')}`), 'dev.sh must load arara-update');
  for (const folder of [staged, path.join(upstream, 'extensions/arara-ai')]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json')));
    assert.equal(pkg.araraEnvironment, 'production');
    assert.equal(pkg.contributes.configuration.properties['arara.apiUrl'].default, 'https://api.code.app.br');
    assert.equal(pkg.contributes.configuration.properties['arara.webUrl'].default, 'https://arara.code.app.br');
    assert.equal(pkg.contributes.configuration.properties['arara.apiUrl'].description, JSON.parse(manifest).contributes.configuration.properties['arara.apiUrl'].description, 'staging preserves native translation references');
  }
  assert.equal(fs.readFileSync(path.join(extension, 'package.json'), 'utf8'), manifest);
  const local = launch(['--local', '--no-sandbox']);
  assert.ok(local.includes(`--extensionDevelopmentPath=${extension}`));
  assert.equal(local[local.indexOf('--user-data-dir') + 1], path.join(localProfile, 'data'));
  const defaults = launch([]); assert.deepEqual(defaults, local.filter(arg => arg !== '--no-sandbox'));
  const productionDefaults = launch(['--production']);
  assert.deepEqual(productionDefaults, args.filter(arg => arg !== '--no-sandbox' && arg !== '/project with spaces'));
  write(path.join(productionProfile, 'data/code.lock'), '999999\n');
  write(path.join(productionProfile, 'data/1.13-main.sock'), 'stale');
  launch(['--production']);
  assert.equal(fs.existsSync(path.join(productionProfile, 'data/code.lock')), false);
  assert.equal(fs.existsSync(path.join(productionProfile, 'data/1.13-main.sock')), false);
  write(path.join(productionProfile, 'data/code.lock'), `${process.pid}\n`);
  write(path.join(productionProfile, 'data/1.13-main.sock'), 'live');
  launch(['--production']);
  assert.equal(fs.existsSync(path.join(productionProfile, 'data/code.lock')), true);
  assert.equal(fs.existsSync(path.join(productionProfile, 'data/1.13-main.sock')), true);
  fs.rmSync(path.join(code, 'extensions/arara-update/package.json'));
  execFileSync('bash', [path.join(code, 'scripts/dev.sh'), '--production'], {
    env: { ...env, ARARA_AI_DIR: path.join(dir, 'missing-ai'), ARARA_BOT_DIR: path.join(dir, 'missing-bot'), ARARA_ORCHESTRA_DIR: path.join(dir, 'missing-orchestra') },
    stdio: 'pipe',
  });
  const withoutExtensions = fs.readFileSync(capture, 'utf8').trim().split('\n');
  assert.equal(withoutExtensions.some(arg => arg.startsWith('--extensionDevelopmentPath=')), false);
  const conflict = spawnSync('bash', [path.join(code, 'scripts/dev.sh'), '--local', '--production'], { env });
  assert.equal(conflict.status, 1);
  console.log('PASS: production endpoints and marker, isolated profiles, reset ordering, unchanged checkout, local/default modes and forwarded Electron arguments.');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
