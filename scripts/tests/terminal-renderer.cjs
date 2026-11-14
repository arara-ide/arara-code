const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '../..');
const upstream = require('./fixtures/terminal-renderer-upstream.json');
const patch = path.join(root, 'patches/code/0045-terminal-renderer.patch');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-terminal-renderer-'));
const historyFile = 'src/vs/workbench/contrib/terminalContrib/history/common/history.ts';
const allFile = 'src/vs/workbench/contrib/terminal/terminal.all.ts';
const rendererFile = 'src/vs/workbench/contrib/terminal/browser/terminalRenderer.ts';
const transpile = source => {
  const exported = [];
  const transformed = stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/^\s*@[A-Za-z_$][\w$]*\r?\n/gm, '')
    .replace(/^import\s+\{([^}]+)\}\s+from\s+(['"][^'"]+['"]);?/gm, (_, names, from) => `const {${names.replace(/\b(\w+)\s+as\s+(\w+)\b/g, '$1: $2')}} = require(${from});`)
    .replace(/\bimport\(/g, '(id => Promise.resolve(require(id)))(')
    .replace(/^export\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
      exported.push(name);
      return `${kind} ${name}`;
    });
  return exported.length ? `${transformed}\nObject.assign(exports, { ${exported.join(', ')} });` : transformed;
};

async function main() {
  try {
    const originals = new Map();
    for (const relative of [historyFile, allFile]) {
      const content = Buffer.from(upstream.files[relative], 'utf8');
      const file = path.join(directory, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      originals.set(file, content);
    }
    execFileSync('git', ['apply', '--check', patch], { cwd: directory });
    execFileSync('git', ['apply', patch], { cwd: directory });
    const source = fs.readFileSync(path.join(directory, historyFile), 'utf8');
    const exports = {};
    const fileService = { readFile: async () => ({ value: { toString: () => 'echo old\npwd\necho new\npwd\npwd\n' } }) };
    const remote = { getEnvironment: async () => undefined, getConnection: () => undefined };
    const serviceIds = { IFileService: 'files', IRemoteAgentService: 'remote' };
    vm.runInNewContext(transpile(source), {
      exports,
      require: name => {
        if (name.endsWith('/lifecycle.js')) return { Disposable: class {} };
        if (name.endsWith('/instantiation.js')) return { IInstantiationService: () => () => {} };
        if (name.endsWith('/configuration.js')) return { IConfigurationService: () => () => {} };
        if (name.endsWith('/storage.js')) return { IStorageService: () => () => {} };
        if (name.endsWith('/files.js')) return { IFileService: serviceIds.IFileService };
        if (name.endsWith('/remoteAgentService.js')) return { IRemoteAgentService: serviceIds.IRemoteAgentService };
        if (name.endsWith('/process.js')) return { env: { HOME: '/fixture' } };
        if (name.endsWith('/platform.js')) return { isWindows: false, OperatingSystem: { Windows: 1 } };
        if (name.endsWith('/network.js')) return { Schemas: { file: 'file', vscodeRemote: 'vscode-remote' } };
        if (name.endsWith('/uri.js')) return { URI: { file: file => ({ path: file }), from: args => args } };
        if (name.endsWith('/path.js')) return { join: path.posix.join };
        if (name.endsWith('/terminal.js')) return { PosixShellType: { Bash: 'bash', Zsh: 'zsh', Fish: 'fish' }, GeneralShellType: { PowerShell: 'pwsh', Python: 'python' } };
        return {};
      },
    });
    const accessor = { get: id => id === serviceIds.IFileService ? fileService : remote };
    assert.deepEqual(Array.from((await exports.getShellFileHistory(accessor, 'zsh')).commands), ['echo old', 'pwd', 'echo new']);
    assert.deepEqual(Array.from((await exports.getShellFileHistory(accessor, 'zsh', true)).commands), ['echo old', 'pwd', 'echo new', 'pwd', 'pwd']);
    assert.equal((await exports.getShellFileHistory(accessor, 'zsh')).commands.length, 3);
    for (const shell of ['bash', 'pwsh', 'python']) assert.equal((await exports.getShellFileHistory(accessor, shell, true)).commands.length, 5);
    fileService.readFile = async () => ({ value: { toString: () => '- cmd: echo old\n- cmd: pwd\n- cmd: pwd\n' } });
    assert.equal((await exports.getShellFileHistory(accessor, 'fish', true)).commands.length, 3);
    exports.clearShellFileHistory();
    fileService.readFile = async () => ({ value: { toString: () => ': 100:0;echo repeated\n: 101:0;echo repeated\n: 102:0;echo latest\n' } });
    assert.deepEqual(Array.from((await exports.getShellFileHistory(accessor, 'zsh', true)).commands), ['echo repeated', 'echo repeated', 'echo latest']);
    assert.deepEqual(Array.from((await exports.getShellFileHistory(accessor, 'zsh')).commands), ['echo repeated', 'echo latest']);
    const renderer = fs.readFileSync(path.join(directory, rendererFile), 'utf8');
    let Renderer;
    const mounted = [];
    let unmounted = 0;
    const decorator = () => () => {};
    vm.runInNewContext(transpile(renderer), { exports: {}, require: name => {
      if (name.endsWith('/lifecycle.js')) return { Disposable: class {
        _store = { isDisposed: false };
        items = [];
        _register(item) { this.items.push(item); return item; }
        dispose() { this._store.isDisposed = true; for (const item of this.items) item.dispose(); }
      } };
      if (name.endsWith('/network.js')) return { Schemas: { file: 'file', vscodeRemote: 'vscode-remote' }, FileAccess: { uriToBrowserUri: uri => ({ toString: () => uri.value }) } };
      if (name.endsWith('/uri.js')) return { URI: { parse: value => ({ value, scheme: value.split(':')[0] }) } };
      if (name.endsWith('/tabFocus.js')) return { TabFocus: { getTabFocusMode: () => false } };
      if (name.endsWith('/commands.js')) return { ICommandService: decorator };
      if (name.endsWith('/contextkey.js')) return { IContextKeyService: decorator };
      if (name.endsWith('/instantiation.js')) return { IInstantiationService: decorator };
      if (name.endsWith('/capabilities.js')) return { TerminalCapability: { CommandDetection: 2 } };
      if (name.endsWith('/terminalExtensions.js')) return { registerTerminalContribution: (_id, ctor) => { Renderer = ctor; } };
      if (name.startsWith('file:')) return { attach: host => { mounted.push(host); return { dispose: () => unmounted++ }; } };
      return {};
    } });
    const descriptor = { version: 1, module: 'file:///fixture/renderer.js', tab: 'TAB', label: 'Complete' };
    const flush = () => new Promise(resolve => setImmediate(resolve));
    const create = command => {
      let focus;
      const instance = { onDidFocus: callback => { focus = callback; return { dispose() {} }; } };
      const contribution = new Renderer({ instance }, { executeCommand: command }, { getContextKeyValue: () => undefined }, {});
      return { contribution, focus: () => focus() };
    };
    const active = create(async (command, version) => { assert.equal(command, 'arara.terminal.renderer'); assert.equal(version, 1); return descriptor; });
    active.contribution.xtermOpen({ raw: {} });
    active.focus();
    await flush();
    assert.equal(mounted.length, 1);
    assert.equal(mounted[0].version, 1);
    assert.equal(mounted[0].tabMovesFocus(), false);
    active.focus(); await flush(); assert.equal(mounted.length, 1);
    active.contribution.dispose(); assert.equal(unmounted, 1);
    for (const invalid of [{ ...descriptor, version: 2 }, { ...descriptor, module: 'https://example.invalid/renderer.js' }, undefined]) {
      const item = create(async () => invalid);
      item.contribution.xtermOpen({ raw: {} }); await flush();
      item.contribution.dispose();
    }
    assert.equal(mounted.length, 1);
    let resolvePending;
    const pending = create(() => new Promise(resolve => { resolvePending = resolve; }));
    pending.contribution.xtermOpen({ raw: {} }); pending.contribution.dispose();
    resolvePending(descriptor); await flush(); assert.equal(mounted.length, 1);
    let attempts = 0;
    const retry = create(async () => { if (++attempts === 1) throw Error('extension not ready'); return descriptor; });
    retry.contribution.xtermOpen({ raw: {} }); await flush();
    retry.focus(); await flush(); assert.equal(mounted.length, 2);
    retry.contribution.dispose(); assert.equal(unmounted, 2);
    execFileSync('git', ['apply', '--reverse', patch], { cwd: directory });
    for (const [file, content] of originals) assert.deepEqual(fs.readFileSync(file), content);
    assert.equal(fs.existsSync(path.join(directory, rendererFile)), false);
    console.log('PASS: renderer patch applies/reverses on clean upstream; native history preserves occurrences for five shells, default deduplication, extended zsh and separate/reset caches; local/versioned renderer bridge parses.');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
