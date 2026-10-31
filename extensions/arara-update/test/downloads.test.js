'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { afterEach, describe, it } = require('node:test');
const { UpdateDownloads, installAction, installInstructions, installerName, updateTarget } = require('../src/downloads');
const { setLanguage } = require('../src/i18n');
const { newerVersion } = require('../src/version');

const roots = [];
afterEach(async () => {
  setLanguage('en');
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const version = '1.135.06780';
const cases = [
  [{ platform: 'darwin', arch: 'arm64', format: 'zip' }, `AraraCode-darwin-arm64-${version}.zip`],
  [{ platform: 'darwin', arch: 'x64', format: 'zip' }, `AraraCode-darwin-x64-${version}.zip`],
  [{ platform: 'win32', arch: 'x64', format: 'user' }, `AraraCodeSetup-x64-${version}.exe`],
  [{ platform: 'win32', arch: 'ia32', format: 'system' }, `AraraCodeSetup-ia32-${version}.exe`],
  [{ platform: 'win32', arch: 'arm64', format: 'user' }, `AraraCodeSetup-arm64-${version}.exe`],
  [{ platform: 'win32', arch: 'x64', format: 'zip' }, `AraraCode-win32-x64-${version}.zip`],
  [{ platform: 'linux', arch: 'x64', format: 'deb' }, `arara-code_${version}_amd64.deb`],
  [{ platform: 'linux', arch: 'arm64', format: 'deb' }, `arara-code_${version}_arm64.deb`],
  [{ platform: 'linux', arch: 'x64', format: 'tar.gz' }, `arara-code-linux-x64-${version}.tar.gz`],
  [{ platform: 'linux', arch: 'x64', format: 'AppImage' }, `AraraCode-linux-x64-${version}.AppImage`],
  [{ platform: 'linux', arch: 'arm64', format: 'AppImage' }, `AraraCode-linux-arm64-${version}.AppImage`],
];

function recordingFetch(impl) {
  const fn = async url => { fn.calls.push(String(url)); return (fn.next.shift() ?? impl)(url); };
  fn.calls = [];
  fn.next = [];
  return fn;
}

async function fixture(target = cases[0][0], badHash = false) {
  const parent = await mkdtemp(join(tmpdir(), 'arara-update-test-'));
  roots.push(parent);
  const root = join(parent, 'cache');
  const name = installerName(version, target);
  const body = 'installer bytes';
  const digest = createHash('sha256').update(badHash ? 'wrong' : body).digest('hex');
  const fetcher = recordingFetch(async url => String(url).endsWith('SHA256SUMS') ? new Response(`${digest}  ./${name}\n`) : new Response(body));
  return { root, name, fetcher, cache: new UpdateDownloads(root, target, fetcher) };
}

describe('installer preparation', () => {
  for (const [target, name] of cases) {
    it(`downloads and reuses the correct installer for ${JSON.stringify(target)}`, async () => {
      assert.equal(installerName(version, target), name);
      const { cache, fetcher } = await fixture(target);
      const ready = await cache.prepare(version);
      assert.equal(await readFile(ready.file, 'utf8'), 'installer bytes');
      assert.deepEqual(await cache.startup('1.135.06700'), ready);
      assert.deepEqual(await cache.prepare(version), ready);
      assert.equal(fetcher.calls.length, 2);
      const action = installAction(ready.file, target.platform);
      assert.equal(action.kind, target.format === 'deb' ? 'terminal' : target.platform === 'win32' && name.endsWith('.exe') ? 'open' : 'reveal');
      if (target.format === 'AppImage') assert.equal((await stat(ready.file)).mode & 0o777, 0o755);
      if (action.kind === 'terminal') assert.equal(action.command, `sudo apt install '${ready.file}'`);
      if (action.kind === 'open') {
        assert.match(action.command, /WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/);
        assert.ok(!action.args.join(' ').includes(ready.file));
        assert.deepEqual(action.env, { ARARA_UPDATE_INSTALLER: ready.file });
      }
      await cache.startup(version);
      await assert.rejects(readdir(cache.root));
    });
  }

  it('does not publish a corrupt download and removes partial files', async () => {
    const { cache, root } = await fixture(undefined, true);
    await assert.rejects(cache.prepare(version), /checksum/);
    assert.equal(await cache.cached(version), null);
    assert.deepEqual(await readdir(root), []);
  });

  it('rejects a modified cached file and downloads it again', async () => {
    const { cache, fetcher } = await fixture();
    const ready = await cache.prepare(version);
    await writeFile(ready.file, 'tampered');
    assert.equal(await cache.startup('1.135.06700'), null);
    await cache.prepare(version);
    assert.equal(fetcher.calls.length, 4);
  });

  it('does not substitute a different architecture when an asset is missing', async () => {
    const { root } = await fixture();
    const cache = new UpdateDownloads(root, cases[3][0], async () => new Response(''));
    await assert.rejects(cache.prepare(version), /not published/);
    assert.equal(await cache.cached(version), null);
  });

  it('cleans older versions offline and preserves future installers', async () => {
    const { cache, root } = await fixture();
    const ready = await cache.prepare(version);
    await mkdir(join(root, '1.135.06000'));
    await writeFile(join(root, '1.135.06000', 'old'), 'old');
    assert.deepEqual(await cache.startup('1.135.06700'), ready);
    assert.deepEqual(await readdir(root), [version]);
  });

  it('rejects unsafe versions and unsupported targets', () => {
    assert.throws(() => installerName('../escape', cases[0][0]));
    assert.throws(() => installerName(version, { platform: 'linux', arch: 'mips', format: 'deb' }));
    assert.equal(newerVersion('1.135.06780', '1.135.06780'), false);
    assert.equal(newerVersion('1.135.06780', '1.135.06781'), false);
  });

  it('removes partial downloads after a connection interruption and retries successfully', async () => {
    const { cache, fetcher, root } = await fixture();
    const sums = await fixture();
    fetcher.next.push(url => sums.fetcher(url), async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('partial')); controller.error(new Error('connection lost')); },
    })));
    await assert.rejects(cache.prepare(version), /connection lost/);
    assert.deepEqual(await readdir(root), []);
    assert.equal(await cache.cached(version), null);
    assert.equal((await cache.prepare(version)).version, version);
  });

  it('deletes a superseded installer before fetching the latest one', async () => {
    const { cache, root, fetcher } = await fixture();
    const old = join(root, '1.135.06701');
    await mkdir(old, { recursive: true });
    await writeFile(join(old, 'installer'), 'old');
    fetcher.next.push(async () => {
      await assert.rejects(readdir(old));
      return new Response('', { status: 503 });
    });
    await assert.rejects(cache.prepare(version), /503/);
    await assert.rejects(readdir(old));
  });
});

describe('installation format selection', () => {
  const formats = [
    ['linux', {}, '/usr/share/arara-code/resources/app', true, 'deb'],
    ['linux', {}, '/opt/arara-code/resources/app', true, 'tar.gz'],
    ['linux', {}, '/usr/share/arara-code/resources/app', false, 'tar.gz'],
    ['linux', { araraInstallFormat: 'appimage' }, '/tmp/.mount_Arara/resources/app', true, 'AppImage'],
    ['linux', { araraInstallFormat: 'appimage' }, '/home/user/squashfs-root/resources/app', false, 'AppImage'],
    ['win32', { target: 'user' }, 'C:\\Arara', false, 'system'],
    ['win32', { target: 'system' }, 'C:\\Arara', false, 'system'],
    ['win32', {}, 'C:\\Portable', false, 'zip'],
    ['darwin', {}, '/Applications/AraraCode.app', false, 'zip'],
  ];
  for (const [platform, product, appRoot, debInstalled, format] of formats) {
    it(`preserves the installation method for ${platform} ${JSON.stringify(product)} ${appRoot}`, () => {
      assert.deepEqual(updateTarget(platform, 'x64', product, appRoot, debInstalled), { platform, arch: 'x64', format });
    });
  }

  it('does not fall back to deb when the AppImage is not yet published', async () => {
    const target = { platform: 'linux', arch: 'x64', format: 'AppImage' };
    const { root } = await fixture(target);
    const fetcher = recordingFetch(async () => new Response(`${'a'.repeat(64)}  arara-code_${version}_amd64.deb\n`));
    await assert.rejects(new UpdateDownloads(root, target, fetcher).prepare(version), /not published/);
    assert.equal(fetcher.calls.length, 1);
  });

  it('opens macOS disk images with open -W so the end of the installer is observable', () => {
    assert.deepEqual(installAction('/tmp/AraraCode.dmg', 'darwin'), { kind: 'open', command: '/usr/bin/open', args: ['-W', '/tmp/AraraCode.dmg'] });
  });
});

describe('installation instructions', () => {
  const names = [`AraraCode-win32-x64-${version}.zip`, `AraraCode-linux-x64-${version}.AppImage`, `AraraCodeSetup-x64-${version}.exe`, 'AraraCode.app', `AraraCode-darwin-x64-${version}.zip`, `arara-code_${version}_amd64.deb`, `arara-code-linux-x64-${version}.tar.gz`];

  it('gives platform-specific instructions in English, Portuguese and Spanish', () => {
    const expected = { en: ['data folder', 'previous AppImage'], pt: ['pasta data', 'AppImage anterior'], es: ['carpeta data', 'AppImage anterior'] };
    for (const [locale, [portable, appImage]] of Object.entries(expected)) {
      setLanguage(locale);
      assert.match(installInstructions(names[0]), new RegExp(portable));
      assert.match(installInstructions(names[1]), new RegExp(appImage));
    }
  });

  it('puts the .deb name inside one complete translated message', () => {
    for (const [locale, reopen] of [['en', 'Then reopen Arara Code.'], ['pt-BR', 'Depois, reabra o Arara Code.'], ['es-MX', 'Después, vuelve a abrir Arara Code.']]) {
      setLanguage(locale);
      const text = installInstructions(names[5]);
      assert.ok(text.includes(`sudo apt install ./${names[5]}. `), text);
      assert.ok(text.endsWith(reopen), text);
    }
  });

  it('never shows an untranslated placeholder', () => {
    for (const locale of ['en', 'pt', 'es']) {
      setLanguage(locale);
      for (const name of names) assert.doesNotMatch(installInstructions(name), /\{\d+\}/);
    }
  });
});
