'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { afterEach, describe, it } = require('node:test');
const { UpdateDownloads, hostArch, installAction, installInstructions, installerName, updateTarget, windowsPowerShell } = require('../src/downloads');
const { setLanguage } = require('../src/i18n');
const { newerVersion } = require('../src/version');

const roots = [];

it('closes the Linux installer shell after success and keeps failures visible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arara-update-shell-'));
  roots.push(root);
  const sudo = join(root, 'sudo');
  await writeFile(sudo, '#!/bin/sh\nprintf "%s\\n" "$@" > "$ARARA_UPDATE_ARGUMENTS"\nexit "$ARARA_UPDATE_RESULT"\n', { mode: 0o700 });
  const file = join(root, "arara ' package.deb");
  for (const status of [0, 10]) {
    const marker = join(root, `arguments-${status}`);
    const child = spawn('/bin/bash', ['--noprofile', '--norc'], {
      env: { ...process.env, PATH: `${root}:/usr/bin:/bin`, ARARA_UPDATE_ARGUMENTS: marker, ARARA_UPDATE_RESULT: String(status) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let timer;
    try {
      const closed = new Promise((resolve, reject) => {
        child.once('exit', code => resolve(code));
        child.once('error', reject);
        timer = setTimeout(() => reject(new Error('Installer shell stayed open after success')), 2000);
      });
      child.stdin.write(installAction(file, 'linux').text + '\n');
      if (status !== 0) {
        for (let attempt = 0; attempt < 100 && !await stat(marker).then(() => true, () => false); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(child.exitCode, null);
        child.stdin.write('exit\n');
      }
      assert.equal(await closed, status);
      assert.equal(await readFile(marker, 'utf8'), `apt\ninstall\n${file}\n`);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
    }
  }
});
afterEach(async () => {
  setLanguage('en');
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const version = '1.135.06780';
const cases = [
  [{ platform: 'darwin', arch: 'arm64', format: 'dmg' }, `AraraCode-darwin-arm64-${version}.dmg`],
  [{ platform: 'darwin', arch: 'x64', format: 'dmg' }, `AraraCode-darwin-x64-${version}.dmg`],
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
      assert.equal(action.kind, target.platform === 'darwin' ? 'mount-reveal' : target.format === 'deb' ? 'terminal' : target.platform === 'win32' && name.endsWith('.exe') ? 'open' : 'reveal');
      if (target.format === 'AppImage') assert.equal((await stat(ready.file)).mode & 0o777, 0o755);
      if (action.kind === 'terminal') assert.equal(action.text, `sudo apt install '${ready.file}' && exit`);
      if (action.kind === 'open' && target.platform === 'win32') {
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

  for (const failure of ['unpublished', 'offline', 'corrupt']) {
    it(`preserves the verified installer when the newer release is ${failure}`, async () => {
      const { cache, fetcher } = await fixture();
      const previous = await cache.prepare(version);
      const nextVersion = '1.135.06800';
      const nextName = installerName(nextVersion, cache.target);
      const digest = createHash('sha256').update('installer bytes').digest('hex');
      fetcher.next.push(async () => failure === 'offline' ? new Response('', { status: 503 })
        : new Response(failure === 'unpublished' ? '' : `${digest}  ${nextName}\n`));
      if (failure === 'corrupt') fetcher.next.push(async () => new Response('corrupt bytes'));
      await assert.rejects(cache.prepare(nextVersion));
      assert.deepEqual(await cache.cached(version), previous);
      assert.equal(await cache.cached(nextVersion), null);
    });
  }

  it('removes the previous installer only after verifying and publishing its replacement', async () => {
    const { cache, fetcher } = await fixture();
    await cache.prepare(version);
    const nextVersion = '1.135.06800';
    const nextName = installerName(nextVersion, cache.target);
    const digest = createHash('sha256').update('new bytes').digest('hex');
    fetcher.next.push(async () => new Response(`${digest}  ${nextName}\n`), async () => {
      assert.ok(await cache.cached(version));
      return new Response('new bytes');
    });
    const next = await cache.prepare(nextVersion);
    assert.equal(await readFile(next.file, 'utf8'), 'new bytes');
    assert.deepEqual(await cache.cached(nextVersion), next);
    assert.equal(await cache.cached(version), null);
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
    ['darwin', {}, '/Applications/AraraCode.app', false, 'dmg'],
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

  it('runs PowerShell only from a standard Windows folder, never from an arbitrary SystemRoot value', () => {
    assert.equal(windowsPowerShell('D:\\Windows'), 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(windowsPowerShell('c:\\windows\\'), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    for (const value of ['C:\\evil', '\\\\server\\share\\Windows', 'C:\\Windows" & calc', '', undefined]) {
      assert.equal(windowsPowerShell(value), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', String(value));
    }
    assert.equal(installAction('C:\\cache\\Setup.exe', 'win32', undefined, undefined, 'E:\\Windows').command, 'E:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });

  it('routes macOS disk images through confirmation, mounting and Finder', () => {
    assert.deepEqual(installAction('/tmp/AraraCode.dmg', 'darwin'), { kind: 'mount-reveal' });
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
it('downloads the DMG of each Mac processor, prefers Apple Silicon under Rosetta and localizes its instructions', async () => {
  for (const arch of ['x64', 'arm64']) {
    const { cache, fetcher } = await fixture({ platform: 'darwin', arch, format: 'dmg' });
    await cache.prepare(version);
    assert.ok(fetcher.calls[1].endsWith(`AraraCode-darwin-${arch}-${version}.dmg`));
    assert.ok(!fetcher.calls.some(url => url.endsWith('.zip')));
  }
  assert.equal(hostArch('darwin', 'x64', true), 'arm64');
  assert.equal(hostArch('darwin', 'x64', false), 'x64');
  assert.equal(hostArch('darwin', 'arm64', false), 'arm64');
  assert.equal(hostArch('linux', 'x64', true), 'x64');
  for (const [locale, expected] of [['en', 'After you continue'], ['pt', 'Ao continuar'], ['es', 'Al continuar']]) {
    setLanguage(locale);
    assert.ok(installInstructions('AraraCode.dmg').startsWith(expected));
  }
});
