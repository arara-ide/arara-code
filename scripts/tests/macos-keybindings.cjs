const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const upstream = process.env.ARARA_UPSTREAM_SOURCE || path.join(root, '.work/vscodium/vscode');
const ts = require(path.join(root, '../arara-ai/node_modules/typescript'));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-keybindings-'));
  try {
    const files = ['workspaceActions.ts', 'quickAccessActions.ts'];
    const relative = 'src/vs/workbench/browser/actions';
    fs.mkdirSync(path.join(dir, relative), { recursive: true });
    for (const file of files) fs.writeFileSync(path.join(dir, relative, file), execFileSync('git', ['show', `HEAD:${relative}/${file}`], { cwd: upstream }));
    if (!process.argv.includes('--before')) execFileSync('git', ['apply', path.join(root, 'patches/code/0041-macos-file-shortcuts.patch')], { cwd: dir });
    const load = name => import(pathToFileURL(path.join(upstream, 'out/vs', name)));
    const { KeyCode, KeyMod, KeyChord } = await load('base/common/keyCodes.js');
    const { decodeKeybinding } = await load('base/common/keybindings.js');
    const { USLayoutResolvedKeybinding } = await load('platform/keybinding/common/usLayoutResolvedKeybinding.js');
    const { ResolvedKeybindingItem } = await load('platform/keybinding/common/resolvedKeybindingItem.js');
    const { KeybindingResolver } = await load('platform/keybinding/common/keybindingResolver.js');
    const context = { KeyCode, KeyMod, KeyChord, KeybindingWeight: { WorkbenchContrib: 200 } };
    const expression = (file, find) => {
      const source = fs.readFileSync(path.join(dir, relative, file), 'utf8');
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      assert.deepEqual(ast.parseDiagnostics, []);
      let node;
      const visit = item => { if (find(item)) node = item.initializer; else ts.forEachChild(item, visit); };
      visit(ast);
      assert.ok(node);
      return vm.runInNewContext(`(${node.getText(ast)})`, context);
    };
    const folder = expression('workspaceActions.ts', item => ts.isPropertyAssignment(item) && item.name.getText() === 'keybinding' && item.getText().includes('KeyChord') && item.getText().includes('KeyCode.KeyO'));
    const quick = expression('quickAccessActions.ts', item => ts.isVariableDeclaration(item) && item.name.getText() === 'globalQuickAccessKeybinding');
    const binding = (key, command, platform) => new ResolvedKeybindingItem(USLayoutResolvedKeybinding.resolveKeybinding(decodeKeybinding(key, platform), platform)[0], command, undefined, undefined, true, null, false);
    const emptyContext = { getValue() {} };
    for (const platform of [1, 2, 3]) {
      const target = platform === 2 ? 'mac' : platform === 1 ? 'win' : 'linux';
      const folderKey = folder[target]?.primary ?? folder.primary;
      assert.ok(folderKey, `folder chord available on ${target}`);
      const defaults = [binding(folderKey, 'openFolder', platform), binding(quick.mac && target === 'mac' ? quick.mac.primary : quick.primary, 'quickOpen', platform)];
      for (const key of target === 'mac' ? quick.mac.secondary ?? [] : quick.secondary) defaults.push(binding(key, 'quickOpen', platform));
      const resolver = new KeybindingResolver(defaults, [], () => {});
      const chord = target === 'mac' ? 'meta' : 'ctrl';
      assert.equal(resolver.resolve(emptyContext, [], `${chord}+K`).kind, 1);
      assert.equal(resolver.resolve(emptyContext, [`${chord}+K`], `${chord}+O`).commandId, 'openFolder');
      assert.equal(resolver.resolve(emptyContext, [], `${chord}+P`).commandId, 'quickOpen');
      assert.equal(resolver.resolve(emptyContext, [], 'ctrl+E').commandId, 'quickOpen');
      if (target === 'mac') assert.equal(resolver.resolve(emptyContext, [], 'meta+E').kind, 0, 'native Use Selection for Find is preserved');
      const override = binding(folderKey, 'customFolder', platform);
      const custom = new KeybindingResolver(defaults, [override], () => {});
      assert.equal(custom.resolve(emptyContext, [`${chord}+K`], `${chord}+O`).commandId, 'customFolder');
    }
    console.log('PASS: native keybinding resolver on macOS/Windows/Linux, folder chord, file search, user overrides and Cmd+E preservation.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
