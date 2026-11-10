'use strict';

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { registerCompanion } = require('../src/companion-register');
const tick = () => new Promise(resolve => setImmediate(resolve));
afterEach(() => mock.timers.reset());

function harness(choice = 'Install Arara Vibes') {
  const state = { installs: [], external: [], errors: [], choice };
  const context = { subscriptions: [] };
  const vscode = { env: { language: 'en', openExternal: async uri => state.external.push(uri) }, ProgressLocation: { Notification: 15 }, Uri: { file: file => file }, window: { showInformationMessage: async text => { if (text.includes('could not')) state.errors.push(text); return state.choice; }, withProgress: (_options, work) => work() } };
  const deps = { env: {}, platform: 'darwin', installedCompanion: () => false, prepareCompanion: async () => '/cache/Vibes.dmg', installMacDmg: async (...args) => state.installs.push(args) };
  return { state, context, vscode, deps };
}

test('the Install button installs the prepared Mac companion directly', async () => {
  mock.timers.enable({ apis: ['setTimeout'] }); const h = harness();
  registerCompanion(h.context, h.vscode, h.deps); mock.timers.tick(30000); await tick();
  assert.deepEqual(h.state.installs, [['/cache/Vibes.dmg', 'arara-vibes']]); assert.deepEqual(h.state.external, []);
});

test('dismissal and disposal never install the companion', async () => {
  mock.timers.enable({ apis: ['setTimeout'] }); const h = harness(undefined); h.state.choice = undefined;
  registerCompanion(h.context, h.vscode, h.deps); mock.timers.tick(30000); await tick();
  assert.deepEqual(h.state.installs, []);
  const disposed = harness(); registerCompanion(disposed.context, disposed.vscode, disposed.deps); disposed.context.subscriptions[0].dispose(); mock.timers.tick(30000); await tick();
  assert.deepEqual(disposed.state.installs, []);
});

test('an installation failure reports a result and preserves the running IDE', async () => {
  mock.timers.enable({ apis: ['setTimeout'] }); const h = harness(); h.deps.installMacDmg = async () => { throw new Error('Permission denied'); };
  registerCompanion(h.context, h.vscode, h.deps); mock.timers.tick(30000); await tick();
  assert.equal(h.state.errors.length, 1);
});
