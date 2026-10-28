const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const upstream = path.join(root, '.work/vscodium/vscode');
const ts = require(require.resolve('typescript', { paths: [upstream, path.resolve(root, '../arara-ai')] }));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arara terminal hooks '));
const files = ['src/vs/workbench/contrib/terminal/browser/baseTerminalBackend.ts', 'src/vs/workbench/contrib/terminal/electron-browser/localTerminalBackend.ts'];

try {
  const originals = files.map(file => process.env.ARARA_TERMINAL_SOURCE
    ? fs.readFileSync(path.join(process.env.ARARA_TERMINAL_SOURCE, file))
    : execFileSync('git', ['show', `HEAD:${file}`], { cwd: upstream }));
  for (let i = 0; i < files.length; i++) {
    fs.mkdirSync(path.dirname(path.join(directory, files[i])), { recursive: true });
    fs.writeFileSync(path.join(directory, files[i]), originals[i]);
  }
  const patch = path.join(root, 'patches/code/0036-terminal-repair-hooks.patch');
  execFileSync('git', ['apply', '--check', patch], { cwd: directory });
  execFileSync('git', ['apply', patch], { cwd: directory });
  const base = fs.readFileSync(path.join(directory, files[0]), 'utf8');
  const source = fs.readFileSync(path.join(directory, files[1]), 'utf8');
  for (const [file, text] of [[files[0], base], [files[1], source]]) {
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    assert.deepEqual(ast.parseDiagnostics, []);
  }
  assert.ok(base.includes('command: unresponsiveCommand ?? TerminalContribCommandId.DeveloperRestartPtyHost'));
  assert.ok(source.includes("isLinux ? 'arara.terminal.repair' : undefined"));
  assert.ok(source.includes("executeCommand('arara.terminal.repair', { automatic: true })"));
  const ast = ts.createSourceFile(files[1], source, ts.ScriptTarget.Latest, true);
  const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'LocalTerminalBackend');
  const reset = cls.members.find(node => node.name?.getText(ast) === '_resetDirectProxy').getText(ast);
  const compiled = ts.transpileModule(`class Fixture { ${reset} }; globalThis.Fixture = Fixture;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = {};
  vm.runInNewContext(compiled, sandbox);
  const owner = new sandbox.Fixture();
  let clears = 0;
  let restarts = 0;
  Object.assign(owner, { _register() {}, _directProxy: {}, _directProxyClientEventually: { p: new Promise(() => {}) }, _directProxyDisposables: { clear() { clears++; } }, restartPtyHost() { restarts++; } });
  const begin = source.indexOf("this._register(CommandsRegistry.registerCommand('arara.internal.restartLocalPtyHost'");
  const end = source.indexOf('\n\t\t}));', begin) + '\n\t\t}));'.length;
  let restart;
  const registration = ts.transpileModule(source.slice(begin, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function() { ${registration} }).call(owner)`, { owner, CommandsRegistry: { registerCommand(_id, handler) { restart = handler; } } });
  restart();
  assert.equal(restarts, 1);
  assert.equal(clears, 1);
  assert.equal(owner._directProxy, undefined);
  assert.equal(owner._directProxyClientEventually, undefined);
  const guard = source.match(/if \(this\._directProxyClientEventually !== directProxyClientEventually\) \{[\s\S]*?\n\t\t\t\}/)[0];
  let closed = 0;
  const oldConnection = {};
  const state = { owner: { _directProxyClientEventually: {} }, directProxyClientEventually: oldConnection, port: { close() { closed++; } }, connected: false };
  vm.runInNewContext(`(function() { ${guard}; connected = true; }).call(owner)`, state);
  assert.equal(closed, 1);
  assert.equal(state.connected, false);
  state.owner._directProxyClientEventually = oldConnection;
  vm.runInNewContext(`(function() { ${guard}; connected = true; }).call(owner)`, state);
  assert.equal(state.connected, true);
  execFileSync('git', ['apply', '--reverse', patch], { cwd: directory });
  for (let i = 0; i < files.length; i++) assert.deepEqual(fs.readFileSync(path.join(directory, files[i])), originals[i]);
  console.log('PASS: patch applies/reverses; consent command for Linux only; restart clears a hung initial connection; stale ports are closed and current ports accepted.');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
