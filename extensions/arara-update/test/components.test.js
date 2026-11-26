'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { after, describe, it } = require('node:test');
const { apiOrigin, componentUpdates, componentsQuery, engineSatisfied, installedComponents, pendingInstalls } = require('../src/components');
const { ComponentDownloads } = require('../src/component-updates');

const token = 'a'.repeat(43);
const installed = [{ name: 'arara-ai', id: 'arara.arara-ai', version: '1.2.0' }, { name: 'arara-bot', id: 'arara.arara-bot', version: '0.4.0' }];
const entry = (over = {}) => ({ name: 'arara-ai', current: '1.2.0', latest: '1.3.0', engine: '^1.134.0', updateAvailable: true, download: { url: `/v1/ide/components/download/${token}`, sha256: 'b'.repeat(64), size: 10, expiresAt: '2026-11-26T12:10:00Z' }, ...over });
const options = { origin: 'https://api.code.app.br', vscodeVersion: '1.135.0' };

describe('component versions', () => {
  it('reports only valid running versions of known components', () => {
    const extensions = { 'arara.arara-ai': { packageJSON: { version: '1.2.0' } }, 'arara.arara-bot': { packageJSON: { version: 'dev' } } };
    const found = installedComponents(id => extensions[id]);
    assert.deepEqual(found, [{ name: 'arara-ai', id: 'arara.arara-ai', version: '1.2.0' }]);
    assert.equal(componentsQuery(installed), 'arara-ai@1.2.0,arara-bot@0.4.0');
  });

  it('uses only the user or default API URL and refuses insecure remote hosts', () => {
    assert.equal(apiOrigin(undefined), 'https://api.code.app.br');
    assert.equal(apiOrigin({ defaultValue: 'https://api.code.app.br/', workspaceValue: 'https://evil.example' }), 'https://api.code.app.br');
    assert.equal(apiOrigin({ globalValue: 'http://localhost:7010', defaultValue: 'https://api.code.app.br' }), 'http://localhost:7010');
    assert.equal(apiOrigin({ globalValue: 'http://evil.example' }), null);
    assert.equal(apiOrigin({ globalValue: 'https://user:pass@api.code.app.br' }), null);
    assert.equal(apiOrigin({ globalValue: 'not a url' }), null);
  });

  it('matches engine ranges like the extension host', () => {
    assert.equal(engineSatisfied('^1.134.0', '1.135.0'), true);
    assert.equal(engineSatisfied('^1.136.0', '1.135.0'), false);
    assert.equal(engineSatisfied('^1.134.0', '2.0.0'), false);
    assert.equal(engineSatisfied('>=1.134.0', '2.0.0'), true);
    assert.equal(engineSatisfied('*', '1.135.0'), false);
  });

  it('holds every component while the IDE itself has an update', () => {
    assert.deepEqual(componentUpdates({ updateAvailable: true, components: [entry()] }, installed, options), { hold: true, updates: [] });
  });

  it('returns verified absolute download links for newer compatible components', () => {
    const result = componentUpdates({ updateAvailable: false, components: [entry(), { ...entry({ name: 'arara-bot', latest: '0.4.0', updateAvailable: false, download: null }) }] }, installed, options);
    assert.deepEqual(result, { hold: false, updates: [{ name: 'arara-ai', id: 'arara.arara-ai', current: '1.2.0', version: '1.3.0', url: `https://api.code.app.br/v1/ide/components/download/${token}`, sha256: 'b'.repeat(64), size: 10 }] });
  });

  it('ignores invalid, older or incompatible entries', () => {
    for (const bad of [
      entry({ latest: '1.1.0' }),
      entry({ engine: '^1.200.0' }),
      entry({ download: { ...entry().download, url: 'https://evil.example/x.vsix' } }),
      entry({ download: { ...entry().download, url: `//evil.example/v1/ide/components/download/${token}` } }),
      entry({ download: { ...entry().download, sha256: 'nope' } }),
      entry({ download: { ...entry().download, size: 0 } }),
      entry({ download: null }),
    ]) assert.deepEqual(componentUpdates({ components: [bad] }, installed, options).updates, []);
    assert.deepEqual(componentUpdates(null, installed, options), { hold: false, updates: [] });
  });

  it('skips versions already installed once to avoid restart loops', () => {
    const updates = [{ id: 'arara.arara-ai', version: '1.3.0' }, { id: 'arara.arara-bot', version: '0.5.0' }];
    assert.deepEqual(pendingInstalls(updates, { 'arara.arara-ai': { version: '1.3.0' } }), [updates[1]]);
    assert.deepEqual(pendingInstalls(updates, { 'arara.arara-ai': { version: '1.2.9' } }), updates);
  });
});

describe('ComponentDownloads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arara-components-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const data = Buffer.from('vsix bytes');
  const digest = createHash('sha256').update(data).digest('hex');
  const update = { id: 'arara.arara-ai', version: '1.3.0', url: `https://api.code.app.br/v1/ide/components/download/${token}`, sha256: digest, size: data.length };
  const respond = (body, init = {}) => async url => { const response = new Response(body, { status: init.status ?? 200 }); Object.defineProperty(response, 'url', { value: init.url ?? url }); return response; };

  it('sends the IDE and component versions to the existing version route', async () => {
    const calls = [];
    const downloads = new ComponentDownloads(dir, async url => { calls.push(url); return Response.json({ updateAvailable: false, components: [entry()] }); });
    const result = await downloads.check({ origin: options.origin, ideVersion: '1.135.06777', vscodeVersion: '1.135.0', installed, signal: new AbortController().signal });
    assert.equal(calls[0], 'https://api.code.app.br/v1/ide/version?current=1.135.06777&components=arara-ai%401.2.0%2Carara-bot%400.4.0');
    assert.equal(result.updates.length, 1);
    await assert.rejects(new ComponentDownloads(dir, async () => new Response('', { status: 503 })).check({ origin: options.origin, ideVersion: '1', vscodeVersion: '1.135.0', installed, signal: new AbortController().signal }), /HTTP 503/);
  });

  it('downloads into the temporary folder only when size and checksum match', async () => {
    const signal = new AbortController().signal;
    const file = await new ComponentDownloads(dir, respond(data, { url: 'https://s3.wasabisys.com/bucket/x' })).download(update, options.origin, signal);
    assert.equal(file, join(dir, 'component-update-temp', 'arara.arara-ai-1.3.0.vsix'));
    assert.deepEqual(readFileSync(file), data);
    await assert.rejects(new ComponentDownloads(dir, respond(Buffer.from('tampered!!'))).download(update, options.origin, signal), /checksum/);
    await assert.rejects(new ComponentDownloads(dir, respond(Buffer.concat([data, data]))).download(update, options.origin, signal), /too large/);
    await assert.rejects(new ComponentDownloads(dir, respond(data, { url: 'http://evil.example/x' })).download(update, options.origin, signal), /left HTTPS/);
    await assert.rejects(new ComponentDownloads(dir, respond('gone', { status: 404 })).download(update, options.origin, signal), /HTTP 404/);
    assert.deepEqual(readdirSync(join(dir, 'component-update-temp')), ['arara.arara-ai-1.3.0.vsix']);
  });

  it('remembers installed versions and cleans the temporary folder', async () => {
    const downloads = new ComponentDownloads(dir);
    assert.deepEqual(await downloads.marker(), {});
    await downloads.remember([update]);
    assert.equal((await downloads.marker())['arara.arara-ai'].version, '1.3.0');
    await downloads.cleanup();
    assert.equal(existsSync(join(dir, 'component-update-temp')), false);
    assert.equal(existsSync(join(dir, 'component-updates.json')), true);
  });
});
