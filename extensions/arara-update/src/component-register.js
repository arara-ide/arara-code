'use strict';

const { ComponentDownloads } = require('./component-updates');
const { apiOrigin, installedComponents, pendingInstalls } = require('./components');
const { t } = require('./i18n');

const INSTALL_COMMAND = 'workbench.extensions.installExtension';
const RESTART_EXTENSIONS_COMMAND = 'arara.update.restartExtensions';

async function updateComponents({ vscode, downloads, busy, ideVersion, ideUpdateReady, signal }) {
  const origin = apiOrigin(vscode.workspace.getConfiguration('arara').inspect('apiUrl'));
  const installed = installedComponents(id => vscode.extensions.getExtension(id));
  if (!origin || !installed.length) return 'skipped';
  await downloads.cleanup();
  const { hold, updates } = await downloads.check({ origin, ideVersion, vscodeVersion: vscode.version, installed, signal });
  if (hold || ideUpdateReady()) return 'held';
  const pending = pendingInstalls(updates, await downloads.marker());
  if (!pending.length) return 'current';
  const run = busy.start();
  if (run === undefined) return 'busy';
  const applied = [];
  try {
    const files = [];
    for (const update of pending) files.push([update, await downloads.download(update, origin, signal)]);
    if (signal.aborted || ideUpdateReady()) throw new Error('Component update cancelled');
    for (const [update, file] of files) {
      await vscode.commands.executeCommand(INSTALL_COMMAND, vscode.Uri.file(file));
      applied.push(update);
    }
  } catch (error) {
    if (!signal.aborted) {
      console.warn('[arara update] Component update failed', error);
      vscode.window.setStatusBarMessage(t('$(warning) Could not update Arara extensions. Arara Code will try again when it opens.'), 10000);
    }
  } finally {
    if (applied.length) await downloads.remember(applied).catch(error => console.warn('[arara update] Component marker failed', error));
    await downloads.cleanup().catch(() => {});
  }
  if (!applied.length || signal.aborted) {
    busy.finish(run);
    return 'failed';
  }
  void Promise.resolve(vscode.commands.executeCommand(RESTART_EXTENSIONS_COMMAND)).catch(error => {
    console.warn('[arara update] Extension restart failed', error);
    busy.finish(run);
    vscode.window.setStatusBarMessage(t('$(check) Arara extensions updated. Reload the window to use them.'), 10000);
  });
  return 'restarting';
}

function registerComponents(context, vscode, { busy, ideVersion, ideUpdateReady, env = process.env, fetchImpl = fetch }) {
  if (vscode.env.remoteName || env.ARARA_DISABLE_COMPONENT_UPDATES === '1') return undefined;
  if (context.extensionMode !== undefined && context.extensionMode !== vscode.ExtensionMode?.Production) return undefined;
  const abort = new AbortController();
  context.subscriptions.push({ dispose: () => abort.abort() });
  const downloads = new ComponentDownloads(context.globalStorageUri.fsPath, fetchImpl);
  return updateComponents({ vscode, downloads, busy, ideVersion, ideUpdateReady, signal: abort.signal }).catch(error => {
    if (!abort.signal.aborted) console.warn('[arara update] Component check failed', error);
    return 'failed';
  });
}

module.exports = { INSTALL_COMMAND, RESTART_EXTENSIONS_COMMAND, registerComponents, updateComponents };
