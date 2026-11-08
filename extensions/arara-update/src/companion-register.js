'use strict';

const { installedCompanion, prepareCompanion } = require('./companion');
const { setLanguage, t } = require('./i18n');

function registerCompanion(context, vscode, deps = { installedCompanion, prepareCompanion, env: process.env }) {
  if (vscode.env.remoteName || deps.env.ARARA_DISABLE_COMPANION_DOWNLOAD === '1' || deps.installedCompanion('arara-vibes')) return;
  setLanguage(vscode.env.language);
  const controller = new AbortController();
  let disposed = false;
  const timer = setTimeout(() => {
    void deps.prepareCompanion('arara-vibes', { signal: controller.signal }).then(async file => {
      if (disposed) return;
      const install = t('Install Arara Vibes');
      const choice = await vscode.window.showInformationMessage(t('Arara Vibes is ready to install. Use your Arara chat in a floating window.'), install);
      if (!disposed && choice === install) await vscode.env.openExternal(vscode.Uri.file(file));
    }).catch(() => {
      if (!disposed && !controller.signal.aborted) void vscode.window.showInformationMessage(t('Arara Vibes could not be prepared. You can download it from the Arara downloads page.'));
    });
  }, 30000);
  context.subscriptions.push({ dispose() { disposed = true; clearTimeout(timer); controller.abort(); } });
}

module.exports = { registerCompanion };
