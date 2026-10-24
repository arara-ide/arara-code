const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync, spawnSync } = require('node:child_process');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '../..');
execFileSync(process.execPath, [path.join(root, 'scripts/generate-localization.cjs'), '--check']);
const patch = fs.readFileSync(path.join(root, 'patches/code/0032-arara-localization.patch'), 'utf8').replace(/\r\n/g, '\n');
const block = patch.split('+++ b/src/vs/araraNls.ts\n')[1].split('--- a/src/vs/nls.ts')[0];
const ts = block.split('\n').filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n');
const source = stripTypeScriptTypes(ts).replace('export function', 'function');
for (const [locale, expected] of [['pt-BR', 'Atualizar'], ['pt_PT', 'Atualizar'], ['es-MX', 'Actualizar'], ['en', 'Update'], ['de', 'Update']]) {
  const localize = vm.runInNewContext(source + '; localizeAraraMessage', { _VSCODE_NLS_LANGUAGE: locale });
  assert.equal(localize('Update'), expected);
  assert.equal(localize('Upstream message'), 'Upstream message');
  assert.equal(localize('constructor'), 'constructor');
  assert.equal(localize('Arara Code {0} is installed. It will restart when the AI finishes responding.').includes('{0}'), true);
}
assert.match(patch, /message = localizeAraraMessage\(originalMessage\)/);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-localization-check-'));
try {
  const relativePatch = 'patches/code/0032-arara-localization.patch';
  const target = path.join(dir, relativePatch);
  for (const file of ['.gitattributes', 'scripts/generate-localization.cjs', 'locales/en.json', 'locales/pt.json', 'locales/es.json', relativePatch]) {
    const destination = path.join(dir, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
  }
  const generate = (...args) => execFileSync(process.execPath, [path.join(dir, 'scripts/generate-localization.cjs'), ...args], { stdio: 'pipe' });
  const rejectStale = () => {
    const result = spawnSync(process.execPath, [path.join(dir, 'scripts/generate-localization.cjs'), '--check'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Localization patch is stale/);
  };
  fs.writeFileSync(target, patch);
  generate('--check');
  fs.writeFileSync(target, patch.replace(/\n/g, '\r\n'));
  generate('--check');
  fs.writeFileSync(target, patch.replace('"Update": "Update"', '"Update": "Changed"'));
  rejectStale();
  fs.writeFileSync(target, patch);
  const catalogPath = path.join(dir, 'locales/es.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  catalog.Update += '!';
  fs.writeFileSync(catalogPath, JSON.stringify(catalog));
  rejectStale();
  generate();
  generate('--check');
  assert.ok(!fs.readFileSync(target, 'utf8').includes('\r'), 'generation always writes LF');

  execFileSync('git', ['init', '--quiet', dir]);
  const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=true', ...args], { cwd: dir, stdio: 'pipe' });
  git('add', '.');
  fs.rmSync(target);
  git('checkout-index', '--force', '--all');
  assert.ok(!fs.readFileSync(target, 'utf8').includes('\r'), 'Git keeps patches at LF with autocrlf=true');
  generate('--check');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log('PASS: core locales, LF/CRLF checks, stale patch rejection and Git autocrlf checkout.');
