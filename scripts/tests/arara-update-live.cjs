'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { test } = require('node:test');

const extension = process.env.ARARA_UPDATE_EXTENSION ?? resolve(__dirname, '../../extensions/arara-update');
const { UpdateChecker } = require(join(extension, 'src/checker'));
const { UpdateDownloads, installerName } = require(join(extension, 'src/downloads'));

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
