#!/usr/bin/env node
// Rebuild touched source files from upstream + ordered patches, then exercise
// actual patched method bodies in isolation. Does not build or launch the IDE.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const checkout = path.join(root, '.work/vscodium/vscode');
const ts = require(path.join(checkout, 'node_modules/typescript'));
const patchName = '0023-auxiliary-action-lock.patch';
const patch = fs.readFileSync(path.join(root, 'patches/code', patchName), 'utf8');
const files = [...patch.matchAll(/^--- a\/(.+)$/gm)].map(m => m[1]);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-auxiliary-test-'));
function method(file, name, globals = {}) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(temp, file), 'utf8'), ts.ScriptTarget.Latest, true);
  let found;
  function visit(node) { if (ts.isMethodDeclaration(node) && node.name.getText(source) === name) { found = node; } ts.forEachChild(node, visit); }
  visit(source);
  assert.ok(found, `method ${name}`);
  const params = found.parameters.map(p => p.getText(source)).join(',');
  const async = found.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';
  const code = `(${async}function(${params}) ${found.body.getText(source)})`;
  return vm.runInNewContext(ts.transpile(code, { target: ts.ScriptTarget.ES2022 }), globals);
}
(async () => {
  try {
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true });
      fs.writeFileSync(path.join(temp, file), execFileSync('git', ['show', `HEAD:${file}`], { cwd: checkout }));
    }
    const dirs = ['.work/vscodium/patches', '.work/vscodium/patches/linux', 'patches/code'];
    for (const dir of dirs) {
      const full = path.join(root, dir);
      if (!fs.existsSync(full)) continue;
      for (const name of fs.readdirSync(full).filter(n => n.endsWith('.patch')).sort()) {
        if (dir === 'patches/code' && name > patchName) continue;
        execFileSync('git', ['apply', '--ignore-whitespace', ...files.map(f => `--include=${f}`), path.join(full, name)], { cwd: temp, stdio: 'pipe' });
      }
    }
    console.log('PASS: patch applies to upstream + all preceding patches');
    const layout = 'src/vs/workbench/browser/layout.ts';
    const pane = 'src/vs/workbench/browser/parts/paneCompositePart.ts';
    const context = { getContextKeyValue: () => true };
    const hidden = method(layout, 'setAuxiliaryBarHidden');
    assert.equal(hidden.call({ araraContextKeyService: context }, false), undefined);
    const maximize = method(layout, 'setAuxiliaryBarMaximized');
    assert.equal(maximize.call({ araraContextKeyService: context }, true), false);
    const open = method(pane, 'doOpenPaneComposite', { Parts: { AUXILIARYBAR_PART: 'auxiliary' } });
    assert.equal(await open.call({ partId: 'auxiliary', contextKeyService: context }, 'chat', true), undefined);
    const sentinel = {};
    assert.equal(await open.call({ partId: 'sidebar', contextKeyService: context, blockOpening: { p: sentinel } }, 'files'), sentinel);
    assert.equal(await open.call({ partId: 'auxiliary', contextKeyService: { getContextKeyValue: () => false }, blockOpening: { p: sentinel } }, 'chat'), sentinel);
    console.log('PASS: lock prevents reveal/maximize/composite opening; unlocked and primary sidebar continue');
    let listener;
    const stop = new Error('stop after registering lock listener');
    const listeners = method(layout, 'registerLayoutListeners');
    let closed = 0;
    const host = { araraContextKeyService: { ...context, onDidChangeContext: cb => { listener = cb; return {}; } }, workbenchGrid: {}, setAuxiliaryBarHidden: value => { assert.equal(value, true); closed++; }, _register: () => { throw stop; } };
    assert.throws(() => listeners.call(host), error => error === stop);
    listener({ affectsSome: () => true });
    assert.equal(closed, 1);
    host.araraContextKeyService.getContextKeyValue = () => false;
    listener({ affectsSome: () => true });
    assert.equal(closed, 1);
    console.log('PASS: acquiring lock closes visible sidebar; releasing lock does not close it');
    for (const file of files.filter(f => f.endsWith('.ts'))) {
      const result = ts.transpileModule(fs.readFileSync(path.join(temp, file), 'utf8'), { fileName: file, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, experimentalDecorators: true } });
      assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
    }
    console.log('PASS: touched TypeScript transpiles');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
