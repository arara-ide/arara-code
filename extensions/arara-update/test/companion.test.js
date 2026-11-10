const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readdir, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { installedCompanion, companionAsset, prepareCompanion } = require('../src/companion');

test('companion detection and platform selection do not guess incompatible architectures', () => {
  assert.equal(installedCompanion('arara-code', 'darwin', '/test', {}, path => path === '/Applications/Arara Code.app'), '/Applications/Arara Code.app');
  const assets = [{ name: 'AraraVibes-mac-arm64-1.0.dmg' }, { name: 'AraraVibes-mac-x64-1.0.dmg' }];
  assert.equal(companionAsset(assets, 'arara-vibes', 'darwin', 'x64'), assets[1]);
  assert.equal(companionAsset(assets, 'arara-vibes', 'darwin', 'arm64'), assets[0]);
  assert.equal(companionAsset(assets, 'arara-vibes', 'linux', 'arm64'), undefined);
  assert.equal(companionAsset(assets, 'unknown', 'darwin', 'x64'), undefined);
});
for (const corrupt of [false, true]) test(`companion download verifies checksums and preserves a verified cache: corrupt=${corrupt}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'arara-companion-'));
  const name = 'AraraVibes-mac-arm64-1.0.dmg';
  const base = 'https://github.com/arara-ide/arara-vibes/releases/download/v1/';
  const bytes = Buffer.from('isolated installer fixture');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const fetch = async url => {
    if (url.includes('api.github.com')) return Response.json({ assets: [{ name, size: bytes.length, browser_download_url: base + name }, { name: 'SHA256SUMS', browser_download_url: base + 'SHA256SUMS' }] });
    if (url.endsWith('SHA256SUMS')) return new Response(`${corrupt ? '0'.repeat(64) : checksum}  ${name}\n`);
    return new Response(bytes);
  };
  try {
    if (corrupt) { await assert.rejects(prepareCompanion('arara-vibes', { root, fetch, platform: 'darwin', arch: 'arm64' }), /checksum mismatch/); assert.deepEqual(await readdir(root), []); }
    else {
      const file = await prepareCompanion('arara-vibes', { root, fetch, platform: 'darwin', arch: 'arm64' });
      assert.equal(file, join(root, name));
      assert.equal(await prepareCompanion('arara-vibes', { root, fetch: () => { throw Error('Must use verified cache'); } }), file);
    }
  } finally { await rm(root, { recursive: true }); }
});

test('latest companion checks select published assets for the requested architecture and installation format', async () => {
  const { latestCompanion } = require('../src/companion');
  const release = (tag_name, names, extra = {}) => ({ tag_name, assets: names.map(name => ({ name })), ...extra });
  const releases = [release('1.135.07430', ['SHA256SUMS', 'AraraCode-arm64.dmg']), release('1.135.07429', ['SHA256SUMS', 'AraraCode-x64.dmg']), release('1.135.07440', ['SHA256SUMS', 'AraraCode-x64.dmg'], { prerelease: true })];
  const fetch = async () => Response.json(releases);
  assert.equal(await latestCompanion('arara-code', { platform: 'darwin', arch: 'x64', fetch }), '1.135.07429');
  assert.equal(await latestCompanion('arara-code', { platform: 'darwin', arch: 'arm64', fetch }), '1.135.07430');
  await assert.rejects(latestCompanion('arara-code', { platform: 'linux', arch: 'x64', format: 'deb', fetch }), /unavailable/);
  await assert.rejects(latestCompanion('arara-code', { fetch: async () => new Response('', { status: 403 }) }), /HTTP 403/);
  await assert.rejects(latestCompanion('unknown'), /Unknown/);
});

test('pins cached installers to the requested release and never reuses a previous version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arara-versioned-companion-'));
  const requests = [];
  let served = 'v0.1.0';
  const fetch = async url => {
    requests.push(url);
    const name = `AraraVibes-mac-arm64-${served}.dmg`;
    const base = `https://github.com/arara-ide/arara-vibes/releases/download/${served}/`;
    const bytes = Buffer.from(served);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (url.includes('api.github.com')) return Response.json({ tag_name: served, assets: [{ name, size: bytes.length, browser_download_url: base + name }, { name: 'SHA256SUMS', browser_download_url: base + 'SHA256SUMS' }] });
    if (url.endsWith('SHA256SUMS')) return new Response(`${checksum}  ${name}\n`);
    return new Response(bytes);
  };
  try {
    const options = { root, fetch, platform: 'darwin', arch: 'arm64' };
    const first = await prepareCompanion('arara-vibes', { ...options, version: served });
    served = 'v0.2.0';
    const next = await prepareCompanion('arara-vibes', { ...options, version: served });
    assert.notEqual(next, first);
    assert.ok(requests.some(url => url.endsWith('/releases/tags/v0.2.0')));
    assert.equal(await prepareCompanion('arara-vibes', { ...options, version: served, fetch: () => { throw Error('Use verified versioned cache'); } }), next);
    await assert.rejects(prepareCompanion('arara-vibes', { ...options, version: 'v0.3.0' }), /Unexpected companion release/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
