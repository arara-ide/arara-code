// Local verification of the read-only terminal bridge without a full IDE build.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const ts = require(process.env.TYPESCRIPT_PATH || path.join(root, '../arara-ai/node_modules/typescript'));
const patch = path.join(root, 'patches/code/0022-terminal-context.patch');
const relative = 'src/vs/workbench/contrib/terminal/browser/terminalActions.ts';
const original = execFileSync('git', ['show', `HEAD:${relative}`], { cwd: path.join(root, '.work/vscodium/vscode') });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-terminal-patch-'));
(async () => {
  try {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, original);
    execFileSync('git', ['apply', '--check', patch], { cwd: dir });
    execFileSync('git', ['apply', patch], { cwd: dir });
    const source = fs.readFileSync(file, 'utf8');
    const added = source.slice(source.indexOf('// Generic read-only bridge:'), source.indexOf("\n\tregisterTerminalAction({\n\t\tid: TerminalCommandId.NewInActiveWorkspace"));
    const actions = new Map(), invoked = [];
    const output = ts.transpileModule(added, { compilerOptions: { target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
    assert.deepEqual(output.diagnostics, []);
    vm.runInNewContext(output.outputText, {
      registerTerminalAction: action => actions.set(action.id, action),
      localize2: (_, title) => title, MenuId: { TerminalInstanceContext: 'context' },
      Codicon: { sparkle: { id: 'sparkle' } }, TerminalCapability: { CommandDetection: 2 }, ICommandService: 'commands',
      parseActionArgs: args => args ? [args] : undefined,
    });
    const instance = { instanceId: 4, title: 'shell', capabilities: { get: () => ({ commands: [{ marker: { line: 10 } }], executingCommandObject: { marker: { line: 58 } } }) },
      xterm: { raw: { getSelection: () => 'selected text', buffer: { active: { length: 80, baseY: 0, cursorY: 59, getLine: i => ({ translateToString: () => `line ${i}` }) } } } } };
    const service = { instances: [instance], activeInstance: instance };
    const read = actions.get('arara.internal.terminalSnapshot').run;
    const result = await read({ service }, null, 4);
    assert.equal(result.id, 4); assert.equal(result.selection, 'selected text');
    assert.equal(result.lines.length, 60); assert.equal(result.lines.at(-1), 'line 59');
    assert.equal(result.commandLines.join(','), '10,58');
    assert.equal(await read({ service }, null, 99), undefined);
    const attach = actions.get('arara.internal.addTerminalToChat');
    assert.equal(attach.menu.id, 'context'); assert.equal(attach.icon.id, 'sparkle');
    await attach.run(null, { get: () => ({ executeCommand: (...args) => invoked.push(args) }) }, { instanceId: 4 });
    assert.deepEqual(invoked[0], ['arara.chat.addTerminal', 4]);
    execFileSync('git', ['apply', '--reverse', patch], { cwd: dir });
    assert.deepEqual(fs.readFileSync(file), original);
    console.log('PASS: patch applies to clean upstream and reverses; selection, buffer, command markers, closed terminal and context target.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
