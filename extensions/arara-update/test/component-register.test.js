'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { UpdateBusy } = require('../src/busy');
const { INSTALL_COMMAND, RESTART_EXTENSIONS_COMMAND, registerComponents, updateComponents } = require('../src/component-register');
const { setLanguage } = require('../src/i18n');

const update = (id, version) => ({ name: id.slice(6), id, current: '1.0.0', version, url: `https://api.code.app.br/v1/ide/components/download/${'a'.repeat(43)}`, sha256: 'b'.repeat(64), size: 10 });

function harness({ check = { hold: false, updates: [update('arara.arara-ai', '1.3.0'), update('arara.arara-bot', '0.5.0')] }, marker = {}, install, restart, download } = {}) {
  const state = { executed: [], busy: [], messages: [], remembered: [], cleanups: 0, downloads: [] };
  const vscode = {
    version: '1.135.0',
    Uri: { file: fsPath => ({ fsPath }) },
    workspace: { getConfiguration: section => ({ inspect: key => (assert.equal(`${section}.${key}`, 'arara.apiUrl'), { defaultValue: 'https://api.code.app.br' }) }) },
    extensions: { getExtension: id => ({ 'arara.arara-ai': { packageJSON: { version: '1.2.0' } }, 'arara.arara-bot': { packageJSON: { version: '0.4.0' } } })[id] },
    commands: {
      executeCommand: async (id, ...args) => {
        state.executed.push([id, ...args]);
        if (id === INSTALL_COMMAND && install) return install(args[0]);
        if (id === RESTART_EXTENSIONS_COMMAND && restart) return restart();
      },
    },
    window: { setStatusBarMessage: text => { state.messages.push(text); } },
  };
  const downloads = {
    cleanup: async () => { state.cleanups++; },
    check: async request => { state.request = request; return check; },
    marker: async () => marker,
    download: async (item, origin) => { state.downloads.push([item.id, origin]); if (download) await download(item); return `/tmp/${item.id}-${item.version}.vsix`; },
    remember: async items => { state.remembered.push(...items.map(item => item.id)); },
  };
  const busy = new UpdateBusy(value => state.busy.push(value));
  return { state, run: (options = {}) => updateComponents({ vscode, downloads, busy, ideVersion: '1.135.06777', ideUpdateReady: () => false, signal: new AbortController().signal, ...options }), busy };
}

describe('component updates', () => {
  it('installs every pending VSIX and restarts the extensions while showing Updating', async () => {
    const { state, run, busy } = harness({ restart: () => new Promise(() => {}) });
    assert.equal(await run(), 'restarting');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(state.request.installed.map(item => item.version), ['1.2.0', '0.4.0']);
    assert.equal(state.request.ideVersion, '1.135.06777');
    assert.deepEqual(state.executed, [
      [INSTALL_COMMAND, { fsPath: '/tmp/arara.arara-ai-1.3.0.vsix' }],
      [INSTALL_COMMAND, { fsPath: '/tmp/arara.arara-bot-0.5.0.vsix' }],
      [RESTART_EXTENSIONS_COMMAND],
    ]);
    assert.deepEqual(state.remembered, ['arara.arara-ai', 'arara.arara-bot']);
    assert.deepEqual(state.busy, [true]);
    assert.equal(busy.busy, true);
    assert.ok(state.cleanups >= 2);
  });

  it('clears Updating when applying versions completes without stopping this host', async () => {
    const { state, run, busy } = harness();
    assert.equal(await run(), 'restarting');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(state.busy, [true, false]);
    assert.equal(busy.busy, false);
  });

  it('waits for the IDE update when the server or the local checker reports one', async () => {
    const held = harness({ check: { hold: true, updates: [] } });
    assert.equal(await held.run(), 'held');
    const ready = harness();
    assert.equal(await ready.run({ ideUpdateReady: () => true }), 'held');
    for (const { state } of [held, ready]) {
      assert.deepEqual(state.executed, []);
      assert.deepEqual(state.busy, []);
    }
  });

  it('does not reinstall a version that was already applied once', async () => {
    const { state, run } = harness({ marker: { 'arara.arara-ai': { version: '1.3.0' }, 'arara.arara-bot': { version: '0.5.0' } } });
    assert.equal(await run(), 'current');
    assert.deepEqual(state.downloads, []);
    assert.deepEqual(state.busy, []);
  });

  it('reports a failed download, releases Updating and keeps the old extensions', async () => {
    setLanguage('pt');
    const { state, run, busy } = harness({ download: async () => { throw new Error('checksum'); } });
    assert.equal(await run(), 'failed');
    assert.deepEqual(state.executed, []);
    assert.deepEqual(state.busy, [true, false]);
    assert.equal(busy.busy, false);
    assert.deepEqual(state.messages, ['$(warning) Não foi possível atualizar as extensões do Arara. O Arara Code tenta de novo quando abrir.']);
    setLanguage('en');
  });

  it('restarts with the components installed before a later install failed', async () => {
    let calls = 0;
    const { state, run } = harness({ install: () => { if (++calls === 2) throw new Error('install failed'); } });
    assert.equal(await run(), 'restarting');
    assert.deepEqual(state.remembered, ['arara.arara-ai']);
    assert.deepEqual(state.executed.at(-1), [RESTART_EXTENSIONS_COMMAND]);
  });

  it('asks for a reload when the core cannot restart the extensions', async () => {
    const { state, run, busy } = harness({ restart: async () => { throw new Error('command not found'); } });
    assert.equal(await run(), 'restarting');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(busy.busy, false);
    assert.deepEqual(state.messages, ['$(check) Arara extensions updated. Reload the window to use them.']);
  });

  it('stays off in remote windows, development hosts and when disabled', () => {
    const context = { extensionMode: 1, subscriptions: [], globalStorageUri: { fsPath: '/tmp/x' } };
    const vscode = { env: {}, ExtensionMode: { Production: 1, Development: 2 } };
    assert.equal(registerComponents(context, { ...vscode, env: { remoteName: 'ssh-remote' } }, { env: {} }), undefined);
    assert.equal(registerComponents({ ...context, extensionMode: 2 }, vscode, { env: {} }), undefined);
    assert.equal(registerComponents(context, vscode, { env: { ARARA_DISABLE_COMPONENT_UPDATES: '1' } }), undefined);
    assert.deepEqual(context.subscriptions, []);
  });
});
