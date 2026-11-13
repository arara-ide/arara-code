const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const upstream = process.env.ARARA_UPSTREAM_SOURCE || path.join(root, '.work/vscodium/vscode');
const ts = require(path.join(root, '../arara-ai/node_modules/typescript'));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-default-keys-'));
  try {
    const file = 'src/vs/workbench/common/arara.defaults.ts';
    const patchFile = path.join(root, 'patches/code/0003-default-settings-keybindings.patch');
    if (process.argv.includes('--before')) {
      fs.writeFileSync(path.join(dir, 'before.patch'), execFileSync('git', ['show', 'HEAD:patches/code/0003-default-settings-keybindings.patch'], { cwd: root }));
    }
    execFileSync('git', ['apply', `--include=${file}`, process.argv.includes('--before') ? path.join(dir, 'before.patch') : patchFile], { cwd: dir });
    const source = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^import .*;$/gm, '').replace(/Registry\.as[\s\S]*?\}\]\);/, '');
    const context = { exports: {} };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
    const load = name => import(pathToFileURL(path.join(upstream, 'out/vs', name)));
    const { KeybindingParser } = await load('base/common/keybindingParser.js');
    const { USLayoutResolvedKeybinding } = await load('platform/keybinding/common/usLayoutResolvedKeybinding.js');
    const { ResolvedKeybindingItem } = await load('platform/keybinding/common/resolvedKeybindingItem.js');
    const { KeybindingResolver } = await load('platform/keybinding/common/keybindingResolver.js');
    for (const platform of [1, 2, 3]) {
      const mac = platform === 2;
      const rules = context.exports.getAraraDefaultKeybindings ? context.exports.getAraraDefaultKeybindings(mac) : mac ? [] : context.exports.araraDefaultKeybindings;
      const binding = (key, command) => new ResolvedKeybindingItem(USLayoutResolvedKeybinding.resolveKeybinding(KeybindingParser.parseKeybinding(key), platform)[0], command, undefined, undefined, true, null, false);
      const defaults = rules.map(rule => binding(rule.key, rule.command));
      const resolver = new KeybindingResolver(defaults, [], () => {});
      const empty = { getValue() {} };
      for (const [key, command] of [['ctrl+Tab', 'workbench.action.nextEditor'], ['ctrl+shift+Tab', 'workbench.action.previousEditor'], [mac ? 'shift+meta+S' : 'ctrl+shift+S', 'saveAll']]) {
        assert.equal(resolver.resolve(empty, [], key).commandId, command);
      }
      const custom = new KeybindingResolver(defaults, [binding('ctrl+Tab', 'custom.next')], () => {});
      assert.equal(custom.resolve(empty, [], 'ctrl+Tab').commandId, 'custom.next');
      if (mac) assert.equal(rules.length, 6, 'only tab navigation and save all change on macOS');
    }
    assert.match(fs.readFileSync(path.join(upstream, 'src/vs/workbench/contrib/files/browser/fileConstants.ts'), 'utf8'), /SAVE_ALL_COMMAND_ID = 'saveAll'/);
    const patch = fs.readFileSync(path.join(root, 'patches/code/0003-default-settings-keybindings.patch'), 'utf8');
    assert.match(patch, /getAraraDefaultKeybindings\(isMacintosh\)\.map/);
    console.log('PASS: save all, visual tab order and user overrides on macOS, Windows and Linux.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
