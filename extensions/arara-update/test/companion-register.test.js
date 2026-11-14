'use strict';

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { registerCompanion } = require('../src/companion-register');
const tick = () => new Promise(resolve => setImmediate(resolve));
afterEach(() => mock.timers.reset());

function harness(choice = 'Install Arara Vibes') {
  const state = { installs: [], external: [], errors: [], messages: [], downloads: 0, choice };
  const context = { subscriptions: [] };
  const vscode = { env: { language: 'en', openExternal: async uri => { state.external.push(uri); return true; } }, ProgressLocation: { Notification: 15 }, Uri: { file: file => file, parse: value => value }, window: { showInformationMessage: async text => { state.messages.push(text); if (text.includes('could not')) state.errors.push(text); return state.choice; }, withProgress: (_options, work) => work() } };
  const deps = { env: {}, platform: 'darwin', installedCompanion: () => false, prepareCompanion: async () => { state.downloads++; return '/cache/Vibes.dmg'; }, installMacDmg: async (...args) => state.installs.push(args) };
  return { state, context, vscode, deps };
}

test('the Install button installs the prepared Mac companion directly', async () => {
  mock.timers.enable({ apis: ['setTimeout'] }); const h = harness();
  registerCompanion(h.context, h.vscode, h.deps); mock.timers.tick(20 * 60_000); await tick();
  assert.deepEqual(h.state.installs, [['/cache/Vibes.dmg', 'arara-vibes']]); assert.deepEqual(h.state.external, []);
});

test('dismissal and disposal never install the companion', async () => {
  mock.timers.enable({ apis: ['setTimeout'] }); const h = harness(undefined); h.state.choice = undefined;
  registerCompanion(h.context, h.vscode, h.deps); mock.timers.tick(20 * 60_000); await tick();
  assert.deepEqual(h.state.installs, []);
  const disposed = harness(); registerCompanion(disposed.context, disposed.vscode, disposed.deps); disposed.context.subscriptions[0].dispose(); mock.timers.tick(20 * 60_000); await tick();
  assert.deepEqual(disposed.state.installs, []);
});

test('an installation failure reports a result and preserves the running IDE', async () => {
  mock.timers.enable({ apis: ['setTimeout'] }); const h = harness(); h.deps.installMacDmg = async () => { throw new Error('Permission denied'); };
  registerCompanion(h.context, h.vscode, h.deps); mock.timers.tick(20 * 60_000); await tick();
  assert.equal(h.state.errors.length, 1);
});

test('recommends Vibes only after twenty minutes on every platform', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  for (const platform of ['darwin', 'win32', 'linux']) {
    const h = harness(); h.deps.platform = platform;
    registerCompanion(h.context, h.vscode, h.deps);
    mock.timers.tick(20 * 60_000 - 1); await tick();
    assert.equal(h.state.messages.length, 0); assert.equal(h.state.downloads, 0);
    mock.timers.tick(1); await tick();
    assert.equal(h.state.messages.length, 1);
    h.context.subscriptions[0].dispose();
  }
});

test('opens the Vibes Store product on Windows without downloading an installer', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); h.deps.platform = 'win32';
  registerCompanion(h.context, h.vscode, h.deps); mock.timers.tick(20 * 60_000); await tick();
  assert.equal(h.state.downloads, 0); assert.deepEqual(h.state.installs, []);
  assert.deepEqual(h.state.external, ['ms-windows-store://pdp/?ProductId=9NGWH23J0M16']);
  assert.match(h.state.messages[0], /Microsoft Store/);
});

test('a failed Store launch on Windows keeps the recommendation in the Store flow', async () => {
  mock.timers.enable({ apis: ['setTimeout'] }); const h = harness(); h.deps.platform = 'win32';
  h.vscode.env.openExternal = async () => false;
  registerCompanion(h.context, h.vscode, h.deps); mock.timers.tick(20 * 60_000); await tick();
  assert.match(h.state.messages.at(-1), /Microsoft Store/);
  assert.equal(h.state.downloads, 0); assert.deepEqual(h.state.installs, []);
});
