'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { mkdtemp, readFile, rm, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { test } = require('node:test');

const extension = process.env.ARARA_UPDATE_EXTENSION ?? resolve(__dirname, '../../extensions/arara-update');
const { UpdateChecker } = require(join(extension, 'src/checker'));
const { UpdateDownloads, installerName } = require(join(extension, 'src/downloads'));
const { UpdateBusy } = require(join(extension, 'src/busy'));
const { ComponentDownloads } = require(join(extension, 'src/component-updates'));
const { INSTALL_COMMAND, RESTART_EXTENSIONS_COMMAND, updateComponents } = require(join(extension, 'src/component-register'));

test('shipped updater survives a partial Mac release, stale checksums and corrupt HTTP downloads', { timeout: 15_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'arara-update-live-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = { platform: 'darwin', arch: 'arm64', format: 'dmg' };
  const previous = '1.135.07353';
  const next = '1.135.07354';
  const payload = Buffer.from('isolated update fixture');
  const digest = createHash('sha256').update(payload).digest('hex');
  const requests = [];
  let phase = 'partial';
  const asset = name => ({ name, state: 'uploaded', size: payload.length });
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url.startsWith('/repos/')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([next, previous].map(version => ({
        tag_name: version,
        assets: [asset('SHA256SUMS'), asset(version === previous || phase !== 'partial' ? installerName(version, target) : `arara-code_${version}_amd64.deb`)],
      }))));
      return;
    }
    const version = req.url.includes(`/${next}/`) ? next : previous;
    if (req.url.endsWith('/SHA256SUMS')) {
      res.end(['partial', 'stale-checksums'].includes(phase) && version === next ? '' : `${digest}  ${installerName(version, target)}\n`);
      return;
    }
    if (phase === 'partial' && version === next) {
      res.writeHead(404).end();
      return;
    }
    res.end(phase === 'corrupt' && version === next ? Buffer.from('corrupt fixture') : payload);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const transport = (url, options) => {
    const upstream = new URL(url);
    return fetch(`${origin}${upstream.pathname}${upstream.search}`, options);
  };
  const downloads = new UpdateDownloads(join(root, 'cache'), target, transport);
  const prepared = [];
  const checker = new UpdateChecker({
    currentVersion: '1.135.07347', target, fetchImpl: transport,
    onUpdate: async info => prepared.push(await downloads.prepare(info.latest)),
  });
  assert.equal((await checker.check()).latest, previous);
  assert.equal(prepared.length, 1);
  const cached = await downloads.cached(previous);
  assert.ok(cached);
  assert.deepEqual(await readFile(cached.file), payload);
  assert.equal(await checker.latest(previous), null);
  assert.ok(!requests.some(path => path.includes(`/download/${next}/`)));

  for (const incomplete of ['stale-checksums', 'corrupt']) {
    phase = incomplete;
    assert.equal((await checker.check()).latest, previous);
    assert.deepEqual(await downloads.cached(previous), cached);
    assert.equal(await downloads.cached(next), null);
    assert.equal(prepared.length, 1);
  }

  phase = 'complete';
  assert.equal((await checker.check()).latest, next);
  assert.equal(prepared.length, 2);
  assert.deepEqual(await readFile((await downloads.cached(next)).file), payload);
  assert.equal(await downloads.cached(previous), null);
  assert.ok(!requests.some(path => path.endsWith('.zip')));
});

test('shipped updater installs a component through a single-use link and holds it while the IDE is outdated', { timeout: 15_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'arara-components-live-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from('isolated component vsix fixture');
  const digest = createHash('sha256').update(payload).digest('hex');
  const token = 'z'.repeat(43);
  const used = new Set();
  let ideOutdated = true;
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push(url.pathname);
    if (url.pathname === '/v1/ide/version') {
      assert.equal(url.searchParams.get('current'), '1.135.07931');
      assert.equal(url.searchParams.get('components'), 'arara-ai@1.2.0,arara-orchestra@0.9.0');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ updateAvailable: ideOutdated, components: [
        { name: 'arara-ai', current: '1.2.0', latest: '1.3.0', engine: '^1.134.0', updateAvailable: true, download: ideOutdated ? null : { url: `/v1/ide/components/download/${token}`, sha256: digest, size: payload.length } },
        { name: 'arara-orchestra', current: '0.9.0', latest: '0.9.0', engine: '^1.134.0', updateAvailable: false, download: null },
      ] }));
      return;
    }
    if (url.pathname === `/v1/ide/components/download/${token}`) {
      if (used.has(token)) { res.writeHead(404).end(); return; }
      used.add(token);
      res.writeHead(302, { location: '/storage/arara.arara-ai-1.3.0.vsix' }).end();
      return;
    }
    if (url.pathname === '/storage/arara.arara-ai-1.3.0.vsix') { res.end(payload); return; }
    res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executed = [];
  const installedBytes = [];
  const vscode = {
    version: '1.135.0',
    Uri: { file: fsPath => ({ fsPath }) },
    workspace: { getConfiguration: () => ({ inspect: () => ({ globalValue: origin, defaultValue: 'https://api.code.app.br' }) }) },
    extensions: { getExtension: id => ({ 'arara.arara-ai': { packageJSON: { version: '1.2.0' } }, 'arara.arara-orchestra': { packageJSON: { version: '0.9.0' } } })[id] },
    commands: { executeCommand: async (id, uri) => { executed.push(id); if (id === INSTALL_COMMAND) installedBytes.push(await readFile(uri.fsPath)); } },
    window: { setStatusBarMessage: () => {} },
  };
  const busyStates = [];
  const run = () => updateComponents({ vscode, downloads: new ComponentDownloads(root), busy: new UpdateBusy(value => busyStates.push(value)), ideVersion: '1.135.07931', ideUpdateReady: () => false, signal: new AbortController().signal });

  assert.equal(await run(), 'held');
  assert.deepEqual(executed, []);
  ideOutdated = false;
  assert.equal(await run(), 'restarting');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(executed, [INSTALL_COMMAND, RESTART_EXTENSIONS_COMMAND]);
  assert.deepEqual(installedBytes, [payload]);
  assert.deepEqual(busyStates, [true, false]);
  assert.equal((await stat(join(root, 'component-update-temp')).catch(() => null)), null);
  assert.equal(await run(), 'current');
  assert.equal(requests.filter(path => path.startsWith('/v1/ide/components/download/')).length, 1);
});
