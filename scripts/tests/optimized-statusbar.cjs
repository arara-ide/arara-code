const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const upstream = path.join(root, '.work/vscodium/vscode');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-statusbar-patch-'));
const files = ['src/vs/workbench/browser/parts/statusbar/statusbarPart.ts', 'src/vs/workbench/browser/parts/statusbar/media/statusbarpart.css'];
try {
  for (const file of files) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, execFileSync('git', ['show', `HEAD:${file}`], { cwd: upstream }));
  }
  execFileSync('git', ['apply', '--check', path.join(root, 'patches/code/0042-optimized-statusbar.patch')], { cwd: dir });
  execFileSync('git', ['apply', path.join(root, 'patches/code/0042-optimized-statusbar.patch')], { cwd: dir });
  const source = fs.readFileSync(path.join(dir, files[0]), 'utf8');
  const hook = source.slice(source.indexOf('\t\tconst updateAdvancedVisibility'), source.indexOf('\n\t\t// Track focus within container'));
  assert.ok(hook.length > 0);
  for (const initial of [undefined, false, true]) {
    let value = initial;
    let listener;
    let hidden;
    let updates = 0;
    let registered = 0;
    const contextKeyService = {
      getContextKeyValue: key => { assert.equal(key, 'arara.ui.hideAdvanced'); return value; },
      onDidChangeContext: callback => { listener = callback; return { dispose() {} }; }
    };
    vm.runInNewContext(`(function () { ${hook} }).call(host)`, {
      host: { contextKeyService, _register: () => { registered++; } },
      parent: { classList: { toggle: (name, visible) => { assert.equal(name, 'arara-hide-advanced'); hidden = visible; updates++; } } }
    });
    assert.equal(hidden, !!initial);
    assert.equal(registered, 1);
    listener({ affectsSome: () => false });
    assert.equal(updates, 1);
    for (value of [true, false, true, false]) {
      listener({ affectsSome: keys => keys.has('arara.ui.hideAdvanced') });
      assert.equal(hidden, value);
    }
  }
  const css = fs.readFileSync(path.join(dir, files[1]), 'utf8');
  const selectors = [...css.matchAll(/arara-hide-advanced \.statusbar-item\[id="([^"]+)"\]/g)].map(match => match[1]);
  assert.deepEqual(selectors, ['status.editor.mode', 'status.editor.eol', 'status.editor.encoding', 'status.editor.indentation', 'status.editor.selection', 'esbenp.prettier-vscode.prettier.status', 'esbenp.prettier-vscode']);
  assert.match(css, /arara-hide-advanced[\s\S]*display: none !important/);
  console.log('PASS: patch applies to upstream, 3 initial states, unrelated context, repeated mode changes and 7 scoped selectors');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
