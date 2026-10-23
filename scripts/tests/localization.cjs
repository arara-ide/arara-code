const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '../..');
execFileSync(process.execPath, [path.join(root, 'scripts/generate-localization.cjs'), '--check']);
const patch = fs.readFileSync(path.join(root, 'patches/code/0032-arara-localization.patch'), 'utf8');
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
console.log('PASS: generated core catalogs, regional locales, English fallback, placeholders and upstream pass-through.');
