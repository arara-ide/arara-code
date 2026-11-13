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
    }
    const { MacLinuxKeyboardMapper } = await load('workbench/services/keybinding/common/macLinuxKeyboardMapper.js');
    const { ContextKeyExpr } = await load('platform/contextkey/common/contextkey.js');
    const { KeymapInfo } = await load('workbench/services/keybinding/common/keymapInfo.js');
    const rules = context.exports.getAraraDefaultKeybindings(true);
    for (const layout of ['en', 'pt']) {
      let mapping;
      const layoutSource = fs.readFileSync(path.join(upstream, `src/vs/workbench/services/keybinding/browser/keyboardLayouts/${layout}.darwin.ts`), 'utf8').replace(/^import .*;$/gm, '');
      vm.runInNewContext(ts.transpileModule(layoutSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
        exports: {}, KeyboardLayoutContribution: { INSTANCE: { registerKeyboardLayout(info) { mapping = info.mapping; } } }
      });
      const raw = new KeymapInfo({ id: layout }, [], mapping).mapping;
      const mapper = new MacLinuxKeyboardMapper(layout === 'en', raw, false, 2);
      const binding = rule => mapper.resolveKeybinding(KeybindingParser.parseKeybinding(rule.key)).map(resolved => new ResolvedKeybindingItem(resolved, rule.command, undefined, ContextKeyExpr.deserialize(rule.when), true, null, false));
      const defaults = rules.flatMap(binding);
      const resolver = new KeybindingResolver(defaults, [], () => {});
      const supported = { getValue(key) { return key === 'terminalProcessSupported'; } };
      const created = { getValue(key) { return key === 'terminalHasBeenCreated'; } };
      const empty = { getValue() {} };
      const codes = new Set(['Backquote', Object.keys(raw).find(code => raw[code].value === "'")]);
      for (const code of codes) {
        assert.ok(code, `${layout}: apostrophe key exists`);
        const event = { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, code };
        const dispatch = mapper.resolveKeyboardEvent(event).getDispatchChords()[0];
        assert.equal(resolver.resolve(supported, [], dispatch)?.commandId, 'workbench.action.terminal.new', `${layout}: Ctrl+Shift+${code}`);
        assert.equal(resolver.resolve(created, [], dispatch)?.commandId, 'workbench.action.terminal.new');
        assert.notEqual(resolver.resolve(empty, [], dispatch)?.commandId, 'workbench.action.terminal.new', 'terminal availability is required');
        const plain = mapper.resolveKeyboardEvent({ ...event, shiftKey: false }).getDispatchChords()[0];
        assert.notEqual(resolver.resolve(supported, [], plain)?.commandId, 'workbench.action.terminal.new');
      }
      const custom = new KeybindingResolver(defaults, binding({ key: "ctrl+shift+'", command: 'custom.terminal' }), () => {});
      const removed = new KeybindingResolver(defaults, binding({ key: "ctrl+shift+'", command: '-workbench.action.terminal.new' }), () => {});
      for (const resolved of mapper.resolveKeybinding(KeybindingParser.parseKeybinding("ctrl+shift+'"))) {
        const dispatch = resolved.getDispatchChords()[0];
        assert.equal(custom.resolve(supported, [], dispatch)?.commandId, 'custom.terminal');
        assert.notEqual(removed.resolve(supported, [], dispatch)?.commandId, 'workbench.action.terminal.new');
      }
    }
    assert.equal(rules.length, 8, 'only terminal creation, tab navigation and save all change on macOS');
    assert.match(fs.readFileSync(path.join(upstream, 'src/vs/workbench/contrib/files/browser/fileConstants.ts'), 'utf8'), /SAVE_ALL_COMMAND_ID = 'saveAll'/);
    const patch = fs.readFileSync(path.join(root, 'patches/code/0003-default-settings-keybindings.patch'), 'utf8');
    assert.match(patch, /getAraraDefaultKeybindings\(isMacintosh\)\.map/);
    console.log('PASS: save all and tabs on all platforms; terminal shortcuts with English/Portuguese native macOS mappings, availability, modifiers and user overrides/removals.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
