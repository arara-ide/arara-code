'use strict';

const { basename, dirname, join } = require('node:path');
const { promisify } = require('node:util');
const { UpdateBusy } = require('./busy');
const { UpdateChecker } = require('./checker');
const { UpdateDownloads, installAction, installInstructions, updateTarget } = require('./downloads');
const { setLanguage, t } = require('./i18n');
const { newerVersion, productVersion } = require('./version');

const UPDATE_OPEN_COMMAND = 'arara.update.open';
const UPDATE_CONTEXT_KEY = 'arara.update.available';
const UPDATE_BUSY_CONTEXT_KEY = 'arara.update.busy';
const DEB_REGISTRY = '/var/lib/dpkg/info/arara-code.list';

function platformDeps() {
  const fs = require('node:fs');
  const fsp = require('node:fs/promises');
  const childProcess = require('node:child_process');
  const os = require('node:os');
  return {
    readFileSync: fs.readFileSync, existsSync: fs.existsSync, mkdir: fsp.mkdir, readdir: fsp.readdir,
    spawn: childProcess.spawn, execFile: promisify(childProcess.execFile), homedir: os.homedir,
    platform: process.platform, arch: process.arch, env: process.env,
    Checker: UpdateChecker, Downloads: UpdateDownloads,
  };
}

function registerUpdate(context, vscode, deps = platformDeps()) {
  setLanguage(vscode.env.language);
  const setContext = (key, value) => vscode.commands.executeCommand('setContext', key, value);
  void setContext(UPDATE_CONTEXT_KEY, false);
  void setContext(UPDATE_BUSY_CONTEXT_KEY, false);
  if (vscode.env.remoteName && context.extension?.extensionKind === vscode.ExtensionKind.Workspace) return undefined;
  const productFile = join(vscode.env.appRoot, 'product.json');
  let current;
  let product;
  try {
    const raw = deps.readFileSync(productFile, 'utf8');
    current = productVersion(raw);
    product = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!current) return undefined;
  const installedVersion = () => {
    try { return productVersion(deps.readFileSync(productFile, 'utf8')); } catch { return null; }
  };
  const target = updateTarget(deps.platform, deps.arch, product, vscode.env.appRoot, deps.existsSync(DEB_REGISTRY));
  const downloads = new deps.Downloads(join(context.globalStorageUri.fsPath, 'ide-update-temp'), target);
  const abort = new AbortController();
  let ready = null;
  let installTerminal;
  let disposed = false;
  const publish = async update => {
    if (disposed) return;
    ready = update;
    await setContext(UPDATE_CONTEXT_KEY, true);
  };
  const withdraw = async () => {
    ready = null;
    await setContext(UPDATE_CONTEXT_KEY, false);
  };
  const checker = new deps.Checker({
    currentVersion: current,
    onUpdate: async found => {
      if (!newerVersion(found.latest, found.current)) throw new Error('Invalid update version');
      await publish(await downloads.prepare(found.latest, abort.signal));
      if (!disposed) vscode.window.setStatusBarMessage(t('$(check) Arara Code {0} is ready to update', found.latest), 8000);
    },
  });
  const busy = new UpdateBusy(value => void setContext(UPDATE_BUSY_CONTEXT_KEY, value));

  const openTerminal = (verified, command, run) => {
    const previous = installTerminal?.terminal;
    const terminal = vscode.window.createTerminal({ name: t('Arara Code {0} · Update', verified.version), cwd: dirname(verified.file), shellPath: '/bin/bash', shellArgs: ['--noprofile', '--norc'] });
    installTerminal = { terminal, run };
    if (previous && vscode.window.terminals.includes(previous)) previous.dispose();
    terminal.show();
    terminal.sendText(command, true);
  };

  const openInstaller = (action, run) => new Promise((resolve, reject) => {
    const child = deps.spawn(action.command, action.args, { detached: true, stdio: 'ignore', windowsHide: true, ...(action.env ? { env: { ...deps.env, ...action.env } } : {}) });
    child.once('error', reject);
    child.once('exit', () => busy.finish(run));
    child.once('spawn', () => { child.unref(); resolve(); });
  });

  const revealApp = async (verified, destination) => {
    await deps.mkdir(destination, { recursive: true });
    await deps.execFile('/usr/bin/ditto', ['-x', '-k', verified.file, destination]);
    const app = (await deps.readdir(destination)).find(entry => entry.endsWith('.app'));
    if (!app) throw new Error('App not found in archive');
    const appPath = join(destination, app);
    await deps.execFile('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', appPath]).catch(() => {});
    await deps.execFile('/usr/bin/open', ['-R', appPath]);
    return app;
  };

  const install = async (run, waitInstaller) => {
    const installed = installedVersion() ?? current;
    if (ready && !newerVersion(ready.version, installed)) {
      await withdraw();
      void vscode.window.showInformationMessage(t('Arara Code {0} is already installed. Restart Arara Code to use it.', installed));
      return;
    }
    const fresh = await checker.latest(ready?.version ?? installed).catch(() => null);
    if (fresh && newerVersion(fresh.latest, ready?.version ?? installed)) {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Arara Code {0} was just released. Downloading the latest version…', fresh.latest) }, async () => {
        await publish(await downloads.prepare(fresh.latest, abort.signal));
      });
    }
    const verified = ready && await downloads.cached(ready.version);
    if (!verified) {
      const missing = ready;
      await withdraw();
      void vscode.window.showInformationMessage(t('The installer is no longer available. Preparing the update again…'));
      if (missing) await publish(await downloads.prepare(missing.version, abort.signal));
      return;
    }
    const action = installAction(verified.file, deps.platform, verified.version, deps.homedir());
    if (deps.platform === 'win32' && product.target === 'user') {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(verified.file));
      waitInstaller();
      void vscode.window.showInformationMessage(t('The standard Windows installer is ready. Close Arara Code and uninstall the old UserSetup installation in Windows Settings, keeping your user data. Then run the downloaded installer to avoid duplicate installations.'));
      return;
    }
    if (action.kind === 'extract-reveal') {
      const app = await revealApp(verified, action.destination);
      waitInstaller();
      void vscode.window.showInformationMessage(t('Arara Code {0}: {1}', verified.version, installInstructions(app)));
      return;
    }
    if (action.kind === 'terminal') {
      openTerminal(verified, action.command, run);
      waitInstaller();
      return;
    }
    if (action.kind === 'open') {
      await openInstaller(action, run);
      waitInstaller();
      return;
    }
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(verified.file));
    waitInstaller();
    void vscode.window.showInformationMessage(t('Arara Code {0} is already downloaded. {1}', verified.version, installInstructions(basename(verified.file))));
  };

  context.subscriptions.push(
    checker,
    { dispose: () => { disposed = true; abort.abort(); busy.dispose(); } },
    vscode.window.onDidCloseTerminal(terminal => {
      if (terminal !== installTerminal?.terminal) return;
      busy.finish(installTerminal.run);
      installTerminal = undefined;
    }),
    vscode.commands.registerCommand(UPDATE_OPEN_COMMAND, async () => {
      const run = busy.start();
      if (run === undefined) return;
      let installing = false;
      try {
        await install(run, () => { installing = true; busy.wait(run); });
      } catch {
        void vscode.window.showErrorMessage(t('Could not open the update installer. Try clicking Update again.'));
      } finally {
        if (!installing) busy.finish(run);
      }
    }),
  );
  void downloads.startup(current).catch(error => console.warn('[arara update] Cache cleanup failed', error)).finally(() => {
    if (!disposed) checker.start();
  });
  return checker;
}

module.exports = { UPDATE_BUSY_CONTEXT_KEY, UPDATE_CONTEXT_KEY, UPDATE_OPEN_COMMAND, registerUpdate };
