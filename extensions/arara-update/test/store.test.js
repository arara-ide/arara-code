'use strict';

const assert = require('node:assert/strict');
const { it } = require('node:test');
const { CATALOG_URL, StoreChecker, catalogVersion, isStoreInstall, releaseFromMsix } = require('../src/store');

const catalog = (...versions) => ({ Products: [{ DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: versions.map(v => ({ PackageFullName: `AraraCode.AraraCode_${v}_x64__r0jhj54qmdcam` })) } } }] }] });

it('recognizes only the Store package install folder', () => {
  assert.equal(isStoreInstall('win32', 'C:\\Program Files\\WindowsApps\\AraraCode.AraraCode_1.135.7347.0_x64__r0jhj54qmdcam\\resources\\app'), true);
  assert.equal(isStoreInstall('win32', 'C:\\Program Files\\Arara Code\\resources\\app'), false);
  assert.equal(isStoreInstall('linux', '/WindowsApps/AraraCode.AraraCode_1/'), false);
});

it('maps the MSIX version back to the release number', () => {
  assert.equal(releaseFromMsix('1.135.7347.0'), '1.135.07347');
  assert.equal(releaseFromMsix('1.110.11607.0'), '1.110.11607');
  assert.equal(releaseFromMsix('1.135.7347.1'), null);
  assert.equal(catalogVersion(catalog('1.135.7347.0', '1.135.7366.0')), '1.135.07366');
  assert.equal(catalogVersion({ Products: [{ DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: [{ PackageFullName: 'Other.App_9.9.9.0_x64__x' }] } } }] }] }), null);
});

it('announces only a newer Store version and only once per version', async () => {
  const calls = [], found = [];
  const fetchImpl = async url => { calls.push(url); return { ok: true, json: async () => catalog('1.135.7366.0') }; };
  const checker = new StoreChecker({ currentVersion: '1.135.07347', fetchImpl, onUpdate: async info => found.push(info.latest), setTimer: () => ({ dispose() {} }) });
  await checker.check(); await checker.check();
  assert.deepEqual(found, ['1.135.07366']); assert.equal(calls[0], CATALOG_URL);
  const same = new StoreChecker({ currentVersion: '1.135.07366', fetchImpl, onUpdate: async info => found.push(info.latest) });
  await same.check(); assert.deepEqual(found, ['1.135.07366']);
  const offline = new StoreChecker({ currentVersion: '1.0.00000', fetchImpl: async () => { throw new Error('offline'); }, onUpdate: async () => found.push('x') });
  await offline.check(); assert.deepEqual(found, ['1.135.07366']);
});

it('reads the real public Store catalog when ARARA_LIVE_STORE=1', { skip: process.env.ARARA_LIVE_STORE !== '1' }, async () => {
  const info = await new StoreChecker({ currentVersion: '1.0.00000', onUpdate: async () => {} }).latest();
  assert.match(info.latest, /^\d+\.\d+\.\d{5}$/);
  console.log('Store version:', info.latest);
});
