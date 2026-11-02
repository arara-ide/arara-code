'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { RELEASES_URL, UpdateChecker } = require('../src/checker');
const { installerName } = require('../src/downloads');
const { productVersion } = require('../src/version');

const releases = (...tags) => async () => Response.json(tags.map(tag => typeof tag === 'string' ? { tag_name: tag } : tag));

function counting(impl) {
  const calls = [];
  const fn = async (...args) => { calls.push(args); return impl(...args); };
  fn.calls = calls;
  return fn;
}

describe('UpdateChecker', () => {
  for (const target of [
    { platform: 'darwin', arch: 'arm64', format: 'dmg' },
    { platform: 'darwin', arch: 'x64', format: 'dmg' },
    { platform: 'linux', arch: 'x64', format: 'AppImage' },
    { platform: 'linux', arch: 'x64', format: 'deb' },
    { platform: 'win32', arch: 'x64', format: 'system' },
  ]) {
    it(`ignores partial releases until the ${JSON.stringify(target)} installer and checksums are uploaded`, async () => {
      const asset = name => ({ name, state: 'uploaded', size: 100 });
      const release = (version, assets) => ({ tag_name: version, assets });
      const available = '1.135.07353';
      const partial = '1.135.07354';
      const published = release(available, [asset(installerName(available, target)), asset('SHA256SUMS')]);
      const pending = release(partial, [asset('unrelated-package.zip'), asset('SHA256SUMS')]);
      const checker = new UpdateChecker({
        currentVersion: '1.135.07347', target, onUpdate: () => {}, fetchImpl: releases(pending, published),
      });
      assert.equal((await checker.latest()).latest, available);
      assert.equal(await checker.latest(available), null);
      pending.assets = [asset(installerName(partial, target))];
      assert.equal(await checker.latest(available), null);
      pending.assets.push({ ...asset('SHA256SUMS'), state: 'starter' });
      assert.equal(await checker.latest(available), null);
      pending.assets[1] = asset('SHA256SUMS');
      pending.assets[0].size = 0;
      assert.equal(await checker.latest(available), null);
      pending.assets[0].size = 100;
      assert.equal((await checker.latest(available)).latest, partial);
    });
  }

  it('keeps platform updates unavailable when assets are absent or malformed', async () => {
    const checker = new UpdateChecker({
      currentVersion: '1.135.07347', target: { platform: 'darwin', arch: 'arm64', format: 'dmg' },
      onUpdate: () => {}, fetchImpl: releases('1.135.07354', { tag_name: '1.135.07353', assets: {} }),
    });
    assert.equal(await checker.latest(), null);
  });

  it('polls every 5 min and keeps looking for a newer release after preparing one', async () => {
    const timer = { fn: undefined, ms: 0, disposed: false };
    const replies = [[], ['1.135.06777'], ['1.135.06777'], ['1.135.06777', '1.135.06790']];
    const fetchImpl = counting(async () => Response.json((replies.shift() ?? []).map(tag_name => ({ tag_name }))));
    const updates = [];
    const checker = new UpdateChecker({
      currentVersion: '1.135.06755', fetchImpl, onUpdate: info => updates.push(info.latest),
      setTimer: (fn, ms) => { timer.fn = fn; timer.ms = ms; return { dispose: () => { timer.disposed = true; } }; },
    });
    checker.start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(fetchImpl.calls[0][0], RELEASES_URL);
    assert.equal(timer.ms, 5 * 60_000);
    assert.deepEqual(updates, []);
    timer.fn();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(updates, ['1.135.06777']);
    assert.equal(checker.update.latest, '1.135.06777');
    await checker.check();
    assert.deepEqual(updates, ['1.135.06777']);
    await checker.check();
    assert.deepEqual(updates, ['1.135.06777', '1.135.06790']);
    checker.dispose();
    assert.equal(timer.disposed, true);
  });

  it('picks the highest non-draft release, including pre-releases', async () => {
    const updates = [];
    const checker = new UpdateChecker({
      currentVersion: '1.135.06700', onUpdate: info => updates.push(info),
      fetchImpl: releases({ tag_name: '1.135.06800', prerelease: true }, '1.135.06780', { tag_name: '1.135.06900', draft: true }, 'invalid', null),
    });
    await checker.check();
    assert.deepEqual(updates, [{ current: '1.135.06700', latest: '1.135.06800' }]);
  });

  it('latest() reports a release newer than the one already prepared', async () => {
    const checker = new UpdateChecker({ currentVersion: '1.135.06700', onUpdate: () => {}, fetchImpl: releases('1.135.06780', '1.135.06800') });
    assert.equal((await checker.latest('1.135.06780')).latest, '1.135.06800');
    assert.equal(await checker.latest('1.135.06800'), null);
  });

  it('ignores network errors, non-200 answers and unexpected bodies', async () => {
    const answers = [() => { throw new Error('ECONNREFUSED'); }, () => new Response('', { status: 503 }), () => Response.json({ message: 'rate limited' })];
    const checker = new UpdateChecker({ currentVersion: '1.135.06700', onUpdate: () => {}, fetchImpl: async () => answers.shift()() });
    for (let i = 0; i < 3; i++) assert.equal(await checker.check(), null);
    assert.equal(checker.update, null);
  });

  it('retries preparation failures and prevents overlapping downloads', async () => {
    let attempts = 0;
    const checker = new UpdateChecker({
      currentVersion: '1.135.06700', fetchImpl: releases('1.135.06780'),
      onUpdate: async () => { attempts++; if (attempts === 1) throw new Error('download interrupted'); },
    });
    assert.equal(await checker.check(), null);
    assert.equal(checker.update, null);
    await Promise.all([checker.check(), checker.check()]);
    assert.equal(attempts, 2);
    assert.equal(checker.update.latest, '1.135.06780');
  });
});

describe('productVersion', () => {
  it('reads the full release version from product.json', () => {
    assert.equal(productVersion(JSON.stringify({ nameShort: 'Arara Code', version: '1.135.06780' })), '1.135.06780');
  });

  it('ignores dev builds, truncated versions and invalid JSON', () => {
    for (const version of ['1.135.0', '1.104.0-dev', '', 'x']) assert.equal(productVersion(JSON.stringify({ version })), null);
    assert.equal(productVersion('{'), null);
    assert.equal(productVersion('{}'), null);
  });
});
