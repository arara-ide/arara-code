'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareLinuxRestart, registerLinuxRestart, RESTART_SCRIPT } = require('../src/linux-restart');

test('prepares an independent user service and forwards only desktop session variables', async () => {
  const calls = [];
  assert.equal(await prepareLinuxRestart(1234, { access: async () => {}, readlink: async () => '/usr/bin/arara-code (deleted)', env: { DISPLAY: ':1', WAYLAND_DISPLAY: 'wayland-1', API_TOKEN: 'private', ELECTRON_RUN_AS_NODE: '1' }, execFile: async (...args) => calls.push(args) }), true);
  const [command, args] = calls.at(-1);
  assert.equal(command, '/usr/bin/systemd-run');
  assert.ok(args.includes('--user')); assert.ok(args.includes('--property=Type=exec'));
  assert.ok(args.includes('--setenv=DISPLAY=:1')); assert.ok(args.includes('--setenv=WAYLAND_DISPLAY=wayland-1'));
  assert.ok(!args.join(' ').includes('private'));
  assert.deepEqual(args.slice(-6), ['/bin/sh', '-c', RESTART_SCRIPT.replace(/\$/g, () => '$$'), 'arara-code-restart', '1234', '/usr/bin/arara-code']); 
  assert.deepEqual(calls[0].slice(0, 2), ['/usr/bin/systemctl', ['--user', 'stop', 'arara-code-restart-1234.service']]);
});

test('rejects invalid process identifiers and unavailable restart services', async () => {
  for (const pid of [0, 1, -1, NaN, '123', 1.2]) await assert.rejects(prepareLinuxRestart(pid), /Invalid/);
  await assert.rejects(prepareLinuxRestart(1234, { access: async () => {}, readlink: async () => '/usr/bin/arara-code', execFile: async () => { throw new Error('No user manager'); } }), /user manager/);
});

test('keeps the IDE open and explains failure when the service cannot be prepared', async () => {
  let handler; const errors = [];
  const vscode = { env: {}, commands: { registerCommand: (name, fn) => { assert.equal(name, 'arara.update.prepareRestart'); handler = fn; return {}; } }, window: { showErrorMessage: message => errors.push(message) } };
  registerLinuxRestart({ subscriptions: [] }, vscode, { platform: 'linux', prepareLinuxRestart: async () => { throw new Error('Unavailable'); } });
  assert.equal(await handler(1234), false); assert.equal(errors.length, 1); assert.match(errors[0], /stay open/);
});

test('does not register a remote workspace or non-Linux restart handler', () => {
  const vscode = { env: {}, commands: { registerCommand: () => { throw new Error('Unexpected handler'); } }, ExtensionKind: { Workspace: 2 } };
  registerLinuxRestart({ subscriptions: [] }, vscode, { platform: 'darwin' });
  vscode.env.remoteName = 'ssh'; registerLinuxRestart({ subscriptions: [], extension: { extensionKind: 2 } }, vscode, { platform: 'linux' });
});

test('the core quits only after the extension prepares the independent restart', async () => {
  const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../../patches/code/0015-ide-update.patch'), 'utf8');
  const functionText = source.match(/\+async function restart[\s\S]*?\n\+}/)[0].split('\n').map(line => line.slice(1)).join('\n').replace(/async function restart\([^\n]+/, 'async function restart(nativeHostService, commandService, environmentService) {').replace('executeCommand<boolean>', 'executeCommand');
  for (const prepared of [false, true]) {
    const calls = [];
    const restart = require('node:vm').runInNewContext(`(${functionText})`, { isLinux: true });
    await restart({ quit: async () => calls.push('quit') }, { executeCommand: async (name, pid) => { calls.push([name, pid]); return prepared; } }, { mainPid: 1234 });
    assert.deepEqual(calls, prepared ? [['arara.update.prepareRestart', 1234], 'quit'] : [['arara.update.prepareRestart', 1234]]);
  }
});

test('escapes systemd expansion in portable paths without treating a filename as shell code', async () => {
  const calls = [];
  await prepareLinuxRestart(1234, { executable: '/tmp/editor $HOME%v', access: async () => {}, env: {}, execFile: async (...args) => calls.push(args) });
  assert.equal(calls.at(-1)[1].at(-1), '/tmp/editor $$HOME%%v');
});
