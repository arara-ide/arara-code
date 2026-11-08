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
