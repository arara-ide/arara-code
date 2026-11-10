'use strict';

const { installedCompanion, prepareCompanion, installMacDmg } = require('./companion');
const { setLanguage, t } = require('./i18n');

function registerCompanion(context, vscode, deps = { installedCompanion, prepareCompanion, installMacDmg, env: process.env, platform: process.platform }) {
  if (vscode.env.remoteName || deps.env.ARARA_DISABLE_COMPANION_DOWNLOAD === '1' || deps.installedCompanion('arara-vibes')) return;
  setLanguage(vscode.env.language);
  const controller = new AbortController();
  let disposed = false;
  const timer = setTimeout(() => {
    void deps.prepareCompanion('arara-vibes', { signal: controller.signal }).then(async file => {
      if (disposed) return;
      const install = t('Install Arara Vibes');
      const choice = await vscode.window.showInformationMessage(t('Arara Vibes is ready to install. Use your Arara chat in a floating window.'), install);
      if (!disposed && choice === install) {
        if (deps.platform === 'darwin') await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Installing Arara Vibes…') }, () => deps.installMacDmg(file, 'arara-vibes'));
        else if (!await vscode.env.openExternal(vscode.Uri.file(file))) throw new Error('Could not open companion installer');
      }
    }).catch(() => {
      if (!disposed && !controller.signal.aborted) void vscode.window.showInformationMessage(t('Arara Vibes could not be prepared. You can download it from the Arara downloads page.'));
    });
  }, 30000);
  context.subscriptions.push({ dispose() { disposed = true; clearTimeout(timer); controller.abort(); } });
}

module.exports = { registerCompanion };
