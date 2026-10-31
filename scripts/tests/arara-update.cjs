const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const extension = path.join(root, 'extensions/arara-update');
const tests = fs.readdirSync(path.join(extension, 'test')).filter(name => name.endsWith('.test.js')).map(name => path.join(extension, 'test', name));
assert.ok(tests.length > 0, 'arara-update must have unit tests');
const unit = spawnSync(process.execPath, ['--test', ...tests], { encoding: 'utf8' });
assert.equal(unit.status, 0, unit.stdout + unit.stderr);

const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'package.json'), 'utf8'));
const keys = [...JSON.stringify(manifest).matchAll(/"%([^%"]+)%"/g)].map(match => match[1]).sort();
for (const nls of ['package.nls.json', 'package.nls.pt.json', 'package.nls.pt-br.json', 'package.nls.es.json']) {
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(extension, nls), 'utf8'))).sort(), keys, nls);
}
assert.deepEqual(manifest.contributes.commands.map(command => command.command), ['arara.update.open']);
const parameters = text => [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
const catalogs = Object.fromEntries(['en', 'pt', 'es'].map(locale => [locale, JSON.parse(fs.readFileSync(path.join(extension, 'src/locales', `${locale}.json`), 'utf8'))]));
for (const [locale, catalog] of Object.entries(catalogs)) {
  assert.deepEqual(Object.keys(catalog).sort(), Object.keys(catalogs.en).sort(), `keys: ${locale}`);
  for (const [key, text] of Object.entries(catalog)) assert.deepEqual(parameters(text), parameters(key), `${locale}: ${key}`);
}
const source = fs.readdirSync(path.join(extension, 'src')).filter(name => name.endsWith('.js')).map(name => fs.readFileSync(path.join(extension, 'src', name), 'utf8')).join('\n');
for (const [, message] of source.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) assert.ok(Object.hasOwn(catalogs.en, message), `uncataloged message: ${message}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara update release '));
try {
  const build = fs.readFileSync(path.join(root, 'scripts/build.sh'), 'utf8');
  const embed = build.match(/^embed_arara_update\(\) \{\n[\s\S]*?^\}/m)?.[0];
  assert.ok(embed, 'release staging function must exist');
  assert.equal(build.match(/^  embed_arara_update$/gm)?.length, 3, 'every platform must embed arara-update');
  const work = path.join(dir, 'work');
  const dest = path.join(work, 'vscode/extensions/arara-update');
  const script = path.join(dir, 'embed.sh');
  fs.writeFileSync(script, `set -euo pipefail\n${embed}\nembed_arara_update\n`);
  const result = spawnSync('bash', [script], { env: { ...process.env, ROOT: root, WORK: work }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const file of ['package.json', 'package.nls.json', 'package.nls.pt-br.json', 'src/extension.js', 'src/register.js', 'src/locales/es.json']) {
    assert.equal(fs.readFileSync(path.join(dest, file), 'utf8'), fs.readFileSync(path.join(extension, file), 'utf8'), file);
  }
  assert.ok(!fs.existsSync(path.join(dest, 'test')), 'tests must not ship');
  console.log(`PASS: arara-update unit tests (${tests.length} files), catalogs and release staging.`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
