'use strict';

const { newerVersion, versionPattern } = require('./version');

const STORE_PRODUCT_ID = '9PLLLF8RWMMM';
const STORE_PACKAGE = 'AraraCode.AraraCode';
const CATALOG_URL = `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${STORE_PRODUCT_ID}&market=US&languages=en-us`;
const STORE_URI = `ms-windows-store://pdp/?ProductId=${STORE_PRODUCT_ID}`;
const CHECK_INTERVAL_MS = 30 * 60_000;

function isStoreInstall(platform, appRoot) {
  return platform === 'win32' && /[\\/]WindowsApps[\\/]AraraCode\.AraraCode_/i.test(String(appRoot));
}

function releaseFromMsix(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)\.0$/.exec(version);
  if (!parts) return null;
  const release = `${Number(parts[1])}.${Number(parts[2])}.${parts[3].padStart(5, '0')}`;
  return versionPattern.test(release) ? release : null;
}

function catalogVersion(body) {
  let latest = null;
  for (const product of Array.isArray(body?.Products) ? body.Products : []) {
    for (const availability of Array.isArray(product?.DisplaySkuAvailabilities) ? product.DisplaySkuAvailabilities : []) {
      for (const pkg of Array.isArray(availability?.Sku?.Properties?.Packages) ? availability.Sku.Properties.Packages : []) {
        const match = new RegExp(`^${STORE_PACKAGE.replace('.', '\\.')}_([\\d.]+)_`).exec(String(pkg?.PackageFullName ?? ''));
        const release = match && releaseFromMsix(match[1]);
        if (release && (!latest || newerVersion(release, latest))) latest = release;
      }
    }
  }
  return latest;
}

class StoreChecker {
  constructor(options) { this.options = options; this.found = null; this.timer = undefined; this.stopped = false; }
  get update() { return this.found; }
  async latest(than = this.options.currentVersion) {
    const res = await (this.options.fetchImpl ?? fetch)(CATALOG_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const version = catalogVersion(await res.json());
    return version && newerVersion(version, than) ? { current: this.options.currentVersion, latest: version } : null;
  }
  async check() {
    if (this.stopped) return this.found;
    try {
      const info = await this.latest(this.found?.latest);
      if (info && !this.stopped) { await this.options.onUpdate(info); this.found = info; }
    } catch {}
    return this.found;
  }
  start() {
    if (this.stopped || this.timer) return;
    void this.check();
    const timer = (this.options.setTimer ?? ((fn, ms) => { const id = setInterval(fn, ms); id.unref?.(); return { dispose: () => clearInterval(id) }; }))(() => void this.check(), this.options.intervalMs ?? CHECK_INTERVAL_MS);
    this.timer = timer;
  }
  dispose() { this.stopped = true; this.timer?.dispose(); this.timer = undefined; }
}

module.exports = { CATALOG_URL, STORE_PRODUCT_ID, STORE_URI, StoreChecker, catalogVersion, isStoreInstall, releaseFromMsix };
