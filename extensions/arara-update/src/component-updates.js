'use strict';

const { createWriteStream } = require('node:fs');
const { mkdir, mkdtemp, readFile, rename, rm, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { componentUpdates, componentsQuery } = require('./components');
const { sha256 } = require('./downloads');

const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

class ComponentDownloads {
  constructor(storage, fetchImpl = fetch) {
    this.storage = storage;
    this.root = join(storage, 'component-update-temp');
    this.markerFile = join(storage, 'component-updates.json');
    this.fetchImpl = fetchImpl;
  }

  async check({ origin, ideVersion, vscodeVersion, installed, signal }) {
    const url = new URL('/v1/ide/version', origin);
    url.searchParams.set('current', ideVersion);
    url.searchParams.set('components', componentsQuery(installed));
    const res = await this.fetchImpl(url.href, { headers: { accept: 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(CHECK_TIMEOUT_MS)]) });
    if (!res.ok) throw new Error(`Component check HTTP ${res.status}`);
    return componentUpdates(await res.json(), installed, { origin, vscodeVersion });
  }

  async download(update, origin, signal) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const staging = await mkdtemp(join(this.root, '.download-'));
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]);
    try {
      const res = await this.fetchImpl(update.url, { signal: requestSignal });
      const final = new URL(res.url || update.url);
      if (final.protocol !== 'https:' && final.origin !== origin) throw new Error('Component download left HTTPS');
      if (!res.ok || !res.body) throw new Error(`Component download HTTP ${res.status}`);
      const file = join(staging, `${update.id}-${update.version}.vsix`);
      let bytes = 0;
      const limit = new Transform({
        transform(chunk, _encoding, done) {
          bytes += chunk.length;
          done(bytes > update.size ? new Error('Component download too large') : null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body), limit, createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal: requestSignal });
      if (bytes !== update.size || await sha256(file) !== update.sha256) throw new Error('Component checksum mismatch');
      const destination = join(this.root, `${update.id}-${update.version}.vsix`);
      await rm(destination, { force: true });
      await rename(file, destination);
      return destination;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async marker() {
    try {
      const value = JSON.parse(await readFile(this.markerFile, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  async remember(updates) {
    const marker = await this.marker();
    for (const update of updates) marker[update.id] = { version: update.version, at: new Date().toISOString() };
    await mkdir(this.storage, { recursive: true, mode: 0o700 });
    const temp = `${this.markerFile}.${process.pid}`;
    await writeFile(temp, JSON.stringify(marker), { mode: 0o600 });
    await rename(temp, this.markerFile);
  }

  cleanup() {
    return rm(this.root, { recursive: true, force: true });
  }
}

module.exports = { ComponentDownloads };
