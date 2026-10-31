'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { afterEach, describe, it, mock } = require('node:test');
const { registerUpdate } = require('../src/register');
const { setLanguage } = require('../src/i18n');

const ready = { version: '1.135.06780', file: '/cache/arara-code.deb' };
const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function harness({ platform = 'linux', product = {}, appRoot = '/usr/share/arara-code/resources/app', language = 'en', remoteName } = {}) {
  const state = {
    product: { version: '1.135.06700', ...product }, executed: [], messages: [], errors: [], terminals: [], closeListeners: [],
    command: undefined, checker: undefined, downloads: undefined, spawned: [], execFiles: [],
    latest: async () => null, prepare: async () => ready, cached: async () => ready, startup: async () => null,
  };
  const vscode = {
    ExtensionKind: { UI: 1, Workspace: 2 },
    ProgressLocation: { Notification: 15 },
    env: { appRoot, language, remoteName },
    Uri: { file: file => ({ fsPath: file }) },
    commands: {
      executeCommand: async (...args) => { state.executed.push(args); },
      registerCommand: (id, fn) => { state.command = { id, fn }; return { dispose() {} }; },
    },
    window: {
      terminals: [],
      withProgress: (_options, task) => task(),
      showInformationMessage: text => { state.messages.push(text); },
      showErrorMessage: text => { state.errors.push(text); },
      setStatusBarMessage: text => { state.messages.push(text); },
      createTerminal: options => {
        const terminal = { options, sent: [], shown: false, disposed: false, show() { this.shown = true; }, sendText(text, run) { this.sent.push([text, run]); }, dispose() { this.disposed = true; } };
        state.terminals.push(terminal);
        vscode.window.terminals.push(terminal);
        return terminal;
      },
      onDidCloseTerminal: listener => { state.closeListeners.push(listener); return { dispose() {} }; },
    },
  };
  class Checker {
    constructor(options) { this.options = options; state.checker = this; }
    latest(than) { return state.latest(than); }
    start() { this.started = true; }
    dispose() {}
  }
  class Downloads {
    constructor(root, target) { this.root = root; this.target = target; state.downloads = this; }
    prepare(version) { return state.prepare(version); }
    cached(version) { return state.cached(version); }
    startup(current) { return state.startup(current); }
  }
  const deps = {
    readFileSync: () => JSON.stringify(state.product), existsSync: () => true,
    mkdir: async () => {}, readdir: async () => ['AraraCode.app'],
    execFile: async (...args) => { state.execFiles.push(args); },
    spawn: (...args) => {
      const child = Object.assign(new EventEmitter(), { unref() {} });
      state.spawned.push({ args, child });
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    homedir: () => '/home/user', platform, arch: 'x64', env: { PATH: '/bin' }, Checker, Downloads,
  };
  const subscriptions = [];
  const context = { subscriptions, extension: { extensionKind: 1 }, globalStorageUri: { fsPath: '/storage' } };
  const result = registerUpdate(context, vscode, deps);
  const contextValues = key => state.executed.filter(call => call[0] === 'setContext' && call[1] === key).map(call => call[2]);
  return {
    state, vscode, result, subscriptions,
    available: () => contextValues('arara.update.available'),
    busy: () => contextValues('arara.update.busy'),
    click: () => state.command.fn(),
    closeTerminal: terminal => state.closeListeners.forEach(listener => listener(terminal)),
    found: async (update = ready) => { state.prepare = async () => update; state.cached = async () => update; await state.checker.options.onUpdate({ current: state.product.version, latest: update.version }); },
  };
}

afterEach(() => { setLanguage('en'); mock.timers.reset(); });

describe('update button', () => {
  it('stays hidden until download completes, then installs the .deb in a terminal', async () => {
    const h = harness();
    assert.equal(h.state.downloads.target.format, 'deb');
    assert.equal(h.state.downloads.root, '/storage/ide-update-temp');
    const download = deferred();
    h.state.prepare = () => download.promise;
    const pending = h.state.checker.options.onUpdate({ current: '1.135.06700', latest: ready.version });
    await tick();
    assert.deepEqual(h.available(), [false]);
    download.resolve(ready);
    await pending;
    assert.deepEqual(h.available(), [false, true]);
    await h.click();
    const [terminal] = h.state.terminals;
    assert.equal(terminal.options.cwd, '/cache');
    assert.equal(terminal.options.shellPath, '/bin/bash');
    assert.equal(terminal.options.name, 'Arara Code 1.135.06780 · Update');
    assert.equal(terminal.shown, true);
    assert.deepEqual(terminal.sent, [["sudo apt install '/cache/arara-code.deb'", true]]);
    assert.ok(!h.state.executed.some(call => call[0] === 'revealFileInOS'));
  });

  it('starts checking only after the cache cleanup and does not publish a cached installer before confirming the release', async () => {
    const h = harness();
    h.state.startup = async () => ready;
    await tick();
    assert.equal(h.state.checker.started, true);
    assert.deepEqual(h.available(), [false]);
  });

  it('keeps the button hidden after a failed download', async () => {
    const h = harness();
    h.state.prepare = async () => { throw new Error('offline'); };
    await assert.rejects(h.state.checker.options.onUpdate({ current: '1.135.06700', latest: ready.version }));
    assert.deepEqual(h.available(), [false]);
  });

  it('does not show a button after disposal during download', async () => {
    const h = harness();
    const download = deferred();
    h.state.prepare = () => download.promise;
    const pending = h.state.checker.options.onUpdate({ current: '1.135.06700', latest: ready.version });
    h.subscriptions[1].dispose();
    download.resolve(ready);
    await pending;
    assert.deepEqual(h.available(), [false]);
  });

  it('downloads a release published after the cached one before installing on click', async () => {
    const h = harness();
    await h.found();
    const newer = { version: '1.135.06800', file: '/cache/new/arara-code.deb' };
    const asked = [];
    h.state.latest = async than => { asked.push(than); return { current: '1.135.06700', latest: newer.version }; };
    const prepared = [];
    h.state.prepare = async version => { prepared.push(version); return newer; };
    h.state.cached = async version => version === newer.version ? newer : ready;
    await h.click();
    assert.deepEqual(asked, [ready.version]);
    assert.deepEqual(prepared, [newer.version]);
    assert.deepEqual(h.state.terminals[0].sent, [["sudo apt install '/cache/new/arara-code.deb'", true]]);
  });

  it('does not reinstall a version that is already on disk', async () => {
    const h = harness();
    await h.found();
    h.state.product = { version: ready.version };
    await h.click();
    assert.deepEqual(h.available(), [false, true, false]);
    assert.deepEqual(h.busy(), [false, true, false]);
    assert.ok(h.state.messages.some(text => text.includes(ready.version)));
    assert.equal(h.state.terminals.length, 0);
  });

  it('does nothing in dev builds or in a remote workspace host', () => {
    assert.equal(harness({ product: { version: '1.135.0-dev' } }).result, undefined);
    const remote = harness({ remoteName: 'ssh-remote' });
    assert.notEqual(remote.result, undefined);
  });

  for (const [platform, product, format, file, instruction] of [
    ['linux', { araraInstallFormat: 'appimage' }, 'AppImage', '/cache/AraraCode-linux-x64-1.135.06780.AppImage', 'previous AppImage'],
    ['win32', { target: 'user' }, 'system', '/cache/AraraCodeSetup-x64-1.135.06780.exe', 'uninstall the old UserSetup'],
    ['win32', {}, 'zip', '/cache/AraraCode-win32-x64-1.135.06780.zip', 'data folder'],
  ]) {
    it(`prepares ${platform} ${JSON.stringify(product)} and leaves manual replacement or migration to the user`, async () => {
      const h = harness({ platform, product });
      assert.equal(h.state.downloads.target.format, format);
      await h.found({ ...ready, file });
      await h.click();
      assert.ok(h.state.executed.some(call => call[0] === 'revealFileInOS' && call[1].fsPath === file));
      assert.ok(h.state.messages.some(text => text.includes(instruction)));
      assert.equal(h.state.terminals.length, 0);
    });
  }

  it('extracts the macOS app, reveals it and shows translated instructions', async () => {
    const h = harness({ platform: 'darwin', language: 'pt-br' });
    await h.found({ ...ready, file: '/cache/AraraCode-darwin-x64-1.135.06780.zip' });
    await h.click();
    assert.deepEqual(h.state.execFiles.map(([command]) => command), ['/usr/bin/ditto', '/usr/bin/xattr', '/usr/bin/open']);
    assert.deepEqual(h.state.execFiles[2][1], ['-R', '/home/user/Downloads/AraraCode-1.135.06780/AraraCode.app']);
    assert.ok(h.state.messages.some(text => text.startsWith('Arara Code 1.135.06780: Feche o Arara Code')));
  });
});

describe('update button while updating', () => {
  it('turns busy before checking the latest release and keeps it until the Linux terminal closes', async () => {
    const h = harness();
    await h.found();
    const answer = deferred();
    h.state.latest = () => answer.promise;
    const pending = h.click();
    assert.deepEqual(h.busy(), [false, true]);
    answer.resolve(null);
    await pending;
    assert.equal(h.state.terminals[0].sent.length, 1);
    assert.deepEqual(h.busy(), [false, true]);
    h.closeTerminal({});
    assert.deepEqual(h.busy(), [false, true]);
    h.closeTerminal(h.state.terminals[0]);
    assert.deepEqual(h.busy(), [false, true, false]);
  });

  it('ignores clicks while updating', async () => {
    const h = harness();
    await h.found();
    await h.click();
    await h.click();
    assert.equal(h.state.terminals.length, 1);
  });

  it('goes back to Update two minutes after opening the installer when the terminal stays open', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const h = harness();
    await h.found();
    await h.click();
    mock.timers.tick(2 * 60_000 - 1);
    assert.equal(h.busy().at(-1), true);
    mock.timers.tick(1);
    assert.equal(h.busy().at(-1), false);
    await h.click();
    assert.equal(h.state.terminals.length, 2);
    assert.equal(h.state.terminals[0].disposed, true);
    h.closeTerminal(h.state.terminals[0]);
    assert.equal(h.busy().at(-1), true);
    h.closeTerminal(h.state.terminals[1]);
    assert.deepEqual(h.busy(), [false, true, false, true, false]);
  });

  it('goes back to Update right away when opening the installer fails', async () => {
    const h = harness();
    await h.found();
    h.state.cached = async () => { throw new Error('disk'); };
    await h.click();
    assert.deepEqual(h.state.errors, ['Could not open the update installer. Try clicking Update again.']);
    assert.equal(h.state.terminals.length, 0);
    assert.deepEqual(h.busy(), [false, true, false]);
  });

  it('waits for the Windows installer process to exit, with the path outside the command line', async () => {
    const h = harness({ platform: 'win32', product: { target: 'system' } });
    const file = 'C:\\cache\\AraraCodeSetup-x64-1.135.06780.exe';
    await h.found({ ...ready, file });
    await h.click();
    const [{ args: [command, args, options], child }] = h.state.spawned;
    assert.match(command, /powershell\.exe$/);
    assert.ok(!args.join(' ').includes('AraraCodeSetup'));
    assert.equal(options.env.ARARA_UPDATE_INSTALLER, file);
    assert.equal(options.env.PATH, '/bin');
    assert.equal(options.detached, true);
    assert.deepEqual(h.busy(), [false, true]);
    child.emit('exit', 0);
    assert.deepEqual(h.busy(), [false, true, false]);
  });
});
