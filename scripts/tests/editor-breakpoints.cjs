const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '../..');
const fixture = require('./fixtures/breakpoint-editor-upstream.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-breakpoints-'));
try {
  const file = path.join(dir, fixture.path);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, fixture.source);
  const patch = path.join(root, 'patches/code/0044-editor-breakpoint-visibility.patch');
  execFileSync('git', ['apply', '--check', patch], { cwd: dir });
  execFileSync('git', ['apply', patch], { cwd: dir });
  const source = fs.readFileSync(file, 'utf8');
  const decoration = source.slice(source.indexOf('function getBreakpointDecorationOptions'), source.indexOf('\ntype BreakpointsForLine'));
  let hidden = true;
  let nativeCalls = 0;
  const native = new Error('native rendering');
  const accessor = { get: key => {
    if (key === 'context') return { getContextKeyValue: key => { assert.equal(key, 'arara.ui.hideAdvanced'); return hidden; } };
    nativeCalls++;
    throw native;
  } };
  const render = vm.runInNewContext(stripTypeScriptTypes(decoration) + '\ngetBreakpointDecorationOptions', {
    IContextKeyService: 'context', IDebugService: 'debug', TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 }
  });
  for (hidden of [true, false, true, false]) {
    if (hidden) {
      const options = render(accessor);
      assert.equal(options.description, 'breakpoint-decoration');
      assert.equal(options.stickiness, 1);
      for (const key of ['glyphMarginClassName', 'glyphMarginHoverMessage', 'before', 'overviewRuler']) assert.equal(options[key], undefined);
    } else assert.throws(() => render(accessor), error => error === native);
  }
  assert.equal(nativeCalls, 2);
  const listener = source.slice(source.indexOf('\t\tthis.toDispose.push(this.contextKeyService.onDidChangeContext'), source.indexOf('\n\t\tthis.toDispose.push(this.editor.onMouseDown'));
  let onContext;
  let hints = 0;
  let widgets = 0;
  let redraws = 0;
  vm.runInNewContext(`(function () { ${listener} }).call(host)`, { host: {
    toDispose: [], contextKeyService: { onDidChangeContext: callback => { onContext = callback; return {}; } },
    ensureBreakpointHintDecoration: line => { assert.equal(line, -1); hints++; },
    closeBreakpointWidget: () => widgets++, setDecorationsScheduler: { schedule: () => redraws++ }
  } });
  onContext({ affectsSome: () => false });
  assert.equal(redraws, 0);
  for (let i = 0; i < 4; i++) onContext({ affectsSome: keys => keys.has('arara.ui.hideAdvanced') });
  assert.equal(redraws, 4); assert.equal(hints, 4); assert.equal(widgets, 4);
  assert.equal(source.match(/getContextKeyValue\('arara.ui.hideAdvanced'\) \|\| !this.debugService/g).length, 3);
  assert.ok(source.includes("const desiredCandidateDecorations = this.contextKeyService.getContextKeyValue('arara.ui.hideAdvanced') ? [] :"));
  console.log('PASS: breakpoint patch applies, repeated optimized/full rendering, preserved range tracking, context redraw, mouse/menu gates and late candidate suppression');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
