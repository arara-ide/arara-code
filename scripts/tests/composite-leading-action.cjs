const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, '../arara-ai/node_modules/typescript'));
const upstream = process.env.ARARA_UPSTREAM_SOURCE || path.join(root, '.work/vscodium/vscode/src/vs/workbench/browser/parts');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-leading-action-'));
try {
  const relative = 'src/vs/workbench/browser/parts';
  fs.mkdirSync(path.join(dir, relative), { recursive: true });
  for (const file of ['compositeBar.ts', 'paneCompositeBar.ts']) fs.copyFileSync(path.join(upstream, file), path.join(dir, relative, file));
  for (const file of ['0017-default-view-container-order.patch', '0034-composite-bar-leading-action.patch']) {
    const patch = path.join(root, 'patches/code', file);
    execFileSync('git', ['apply', '--check', patch], { cwd: dir });
    execFileSync('git', ['apply', patch], { cwd: dir });
  }
  const source = fs.readFileSync(path.join(dir, relative, 'compositeBar.ts'), 'utf8');
  const ast = ts.createSourceFile('compositeBar.ts', source, ts.ScriptTarget.Latest, true);
  assert.deepEqual(ast.parseDiagnostics, []);
  const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'CompositeBar');
  const names = ['setLeadingAction', 'updateCompositeSwitcher', 'getOverflowingComposites'];
  const methods = cls.members.filter(node => names.includes(node.name?.getText(ast))).map(node => node.getText(ast)).join('\n');
  class Action {
    constructor(id, label, css, enabled, run) { Object.assign(this, { id, label, css, enabled, run }); }
    dispose() { this.disposed = true; }
  }
  class Overflow { constructor() { this.id = 'overflow'; } }
  const context = { Action, CompositeOverflowActivityAction: Overflow, CompositeOverflowActivityActionViewItem: class {}, ActionsOrientation: { VERTICAL: 1, HORIZONTAL: 0 } };
  const compiled = ts.transpileModule(`class Fixture { ${methods} }; globalThis.Fixture = Fixture;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(compiled.outputText, context);
  const fixture = new context.Fixture();
  const items = ['one', 'two', 'sharing'].map(id => ({ id, pinned: true, activityAction: new Action(id), activity: [] }));
  const bar = { items: [], push(action, options = {}) { this.items.splice(options.index ?? this.items.length, 0, ...(Array.isArray(action) ? action : [action])); }, pull(index) { return this.items.splice(index, 1)[0]; }, length() { return this.items.length; } };
  Object.assign(fixture, { compositeSwitcherBar: bar, options: { orientation: 0, icon: true, compositeSize: 32, overflowActionSize: 32 },
    model: { visibleItems: items, findItem: id => items.find(item => item.id === id) }, visibleComposites: [], dimension: { width: 320, height: 32 },
    compositeSizeInBar: new Map(items.map(item => [item.id, 32])), compositeOverflowAction: {}, compositeOverflowActionViewItem: {},
    getAction: id => items.find(item => item.id === id)?.activityAction, instantiationService: { createInstance: (Class, ...args) => new Class(...args) }, _onDidChange: { fire() {} } });
  fixture.updateCompositeSwitcher();
  assert.deepEqual(bar.items.map(item => item.id), ['one', 'two', 'sharing']);
  const leading = { id: 'sharing', label: 'Sharing', icon: 'broadcast', color: 'arara.platformUnreadForeground', active: false, run: async () => {} };
  fixture.setLeadingAction(leading);
  assert.deepEqual(bar.items.map(item => item.id), ['sharing.leading', 'one', 'two']);
  const unchanged = bar.items[0];
  fixture.setLeadingAction({ ...leading });
  assert.equal(bar.items[0], unchanged, 'counter updates preserve native keyboard focus');
  fixture.model.visibleItems = [items[1], items[0], items[2]];
  fixture.updateCompositeSwitcher();
  assert.deepEqual(bar.items.map(item => item.id), ['sharing.leading', 'two', 'one']);
  fixture.setLeadingAction({ ...leading, active: true });
  assert.equal(bar.items[0].checked, true);
  fixture.model.activeItem = items[2];
  fixture.dimension.width = 64;
  fixture.updateCompositeSwitcher();
  assert.equal(bar.items[0].id, 'sharing.leading', 'the fixed action remains first during overflow');
  assert.ok(!fixture.getOverflowingComposites().some(item => item.id === 'sharing'), 'no duplicate in overflow');
  fixture.dimension.width = 320;
  fixture.setLeadingAction();
  assert.equal(bar.items.some(item => item.id.endsWith('.leading')), false);
  assert.ok(bar.items.some(item => item.id === 'sharing'));
  execFileSync('git', ['apply', '--reverse', path.join(root, 'patches/code/0034-composite-bar-leading-action.patch')], { cwd: dir });
  execFileSync('git', ['apply', '--reverse', path.join(root, 'patches/code/0017-default-view-container-order.patch')], { cwd: dir });
  for (const file of ['compositeBar.ts', 'paneCompositeBar.ts']) assert.deepEqual(fs.readFileSync(path.join(dir, relative, file)), fs.readFileSync(path.join(upstream, file)));
  console.log('PASS: real patch apply/reverse, fixed first item, native selected state, focus stability, platform reorder, overflow and removal.');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
