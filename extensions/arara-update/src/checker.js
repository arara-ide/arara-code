'use strict';

const { newerVersion } = require('./version');

const CHECK_INTERVAL_MS = 5 * 60_000;
const RELEASES_URL = 'https://api.github.com/repos/arara-ide/arara-code/releases?per_page=100';

const defaultTimer = (fn, ms) => {
  const timer = setInterval(fn, ms);
  timer.unref?.();
  return { dispose: () => clearInterval(timer) };
};

class UpdateChecker {
  constructor(options) {
    this.options = options;
    this.timer = undefined;
    this.stopped = false;
    this.found = null;
    this.checking = false;
  }

  get update() {
    return this.found;
  }

  start() {
    if (this.stopped || this.timer) return;
    const setTimer = this.options.setTimer ?? defaultTimer;
    void this.check();
    this.timer = setTimer(() => void this.check(), this.options.intervalMs ?? CHECK_INTERVAL_MS);
  }

  dispose() {
    this.stopped = true;
    this.timer?.dispose();
    this.timer = undefined;
  }

  async latest(than = this.options.currentVersion) {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const res = await fetchImpl(RELEASES_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = await res.json();
    if (!Array.isArray(body)) return null;
    let latest = null;
    for (const release of body) {
      if (!release || release.draft || typeof release.tag_name !== 'string') continue;
      if (newerVersion(release.tag_name, latest ?? than)) latest = release.tag_name;
    }
    return latest ? { current: this.options.currentVersion, latest } : null;
  }

  async check() {
    if (this.stopped || this.checking) return this.found;
    this.checking = true;
    try {
      const info = await this.latest(this.found?.latest);
      if (!info || this.stopped) return this.found;
      await this.options.onUpdate(info);
      if (this.stopped) return this.found;
      this.found = info;
      return info;
    } catch {
      return this.found;
    } finally {
      this.checking = false;
    }
  }
}

module.exports = { CHECK_INTERVAL_MS, RELEASES_URL, UpdateChecker };
