'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { EventEmitter } = require('node:events');
const { installMacDmg, macDestination, macMainPid, SWAP_SCRIPT } = require('../src/mac-install');

async function fixture(t) {
  const home = await fs.mkdtemp(join(tmpdir(), 'arara-mac-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const destination = join(home, 'Applications', 'Arara Code.app');
  await fs.mkdir(join(destination, 'Contents'), { recursive: true });
  await fs.writeFile(join(destination, 'Contents/version'), 'old');
  const calls = [];
  const state = { fail: undefined, id: 'com.arara.code', spawned: [] };
  const execFile = async (command, args) => {
    calls.push([command, args]);
    if (command === state.fail) throw new Error('Native command failed');
    if (command.endsWith('PlistBuddy')) return { stdout: state.id };
    if (command.endsWith('/ps')) return { stdout: '' };
    if (command.endsWith('hdiutil') && args[0] === 'attach') {
      const source = join(args[args.indexOf('-mountpoint') + 1], 'AraraCode.app', 'Contents');
      await fs.mkdir(source, { recursive: true }); await fs.writeFile(join(source, 'version'), 'new');
    }
    if (command.endsWith('hdiutil') && args[0] === 'detach') {
      await fs.rm(join(args[1], 'AraraCode.app'), { recursive: true });
    }
    if (command.endsWith('ditto')) await fs.cp(args.at(-2), args.at(-1), { recursive: true });
    return { stdout: '' };
  };
  const spawn = (...args) => {
    state.spawned.push(args);
    const child = Object.assign(new EventEmitter(), { unref() {} });
    queueMicrotask(() => child.emit('spawn')); return child;
  };
  return { home, destination, calls, state, options: { home, appRoot: `${destination}/Contents/MacOS/Arara Code`, tmpdir: home }, deps: { execFile, spawn } };
}

test('mac destination preserves the installed bundle and rejects non-Applications paths', () => {
  assert.equal(macDestination('arara-code', '/Applications/AraraCode.app/Contents/Resources/app'), '/Applications/AraraCode.app');
  assert.throws(() => macDestination('arara-code', '/Volumes/Installer/AraraCode.app/Contents/Resources/app'));
  assert.throws(() => macDestination('unknown'));
});

test('discovers the main Mac process without guessing the extension host parent', async () => {
  const run = async () => ({ stdout: '  123 /Applications/Arara Code.app/Contents/MacOS/Electron\n  456 /Applications/Arara Code.app/Contents/Frameworks/Helper\n' });
  assert.equal(await macMainPid('/Applications/Arara Code.app/Contents/Resources/app', run), 123);
  await assert.rejects(macMainPid('/Applications/Arara Code.app/Contents/Resources/app', async () => ({ stdout: '' })));
});

test('stages, verifies and hands off without replacing a running application', async t => {
  const f = await fixture(t);
  await installMacDmg('/cache/update.dmg', 'arara-code', { ...f.options, waitPid: 123 }, f.deps);
  assert.equal(await fs.readFile(join(f.destination, 'Contents/version'), 'utf8'), 'old');
  assert.equal(f.state.spawned.length, 1);
  const [command, args, options] = f.state.spawned[0];
  assert.equal(command, '/bin/bash'); assert.equal(options.detached, true);
  assert.equal(args.at(-1), '123'); assert.equal(args.at(-2), f.destination);
  assert.equal(await fs.readFile(args[0], 'utf8'), SWAP_SCRIPT);
  assert.ok(f.calls.some(([cmd]) => cmd === '/usr/bin/codesign'));
  assert.ok(f.calls.some(([cmd]) => cmd === '/usr/sbin/spctl'));
  assert.ok(f.calls.some(([cmd, args]) => cmd.endsWith('hdiutil') && args[0] === 'detach'));
});

for (const failure of ['/usr/bin/ditto', '/usr/bin/codesign', '/usr/sbin/spctl', '/usr/bin/open']) {
  test(`preserves the previous application after ${failure} fails`, async t => {
    const f = await fixture(t); f.state.fail = failure;
    await assert.rejects(installMacDmg('/cache/update.dmg', 'arara-code', f.options, f.deps));
    assert.equal(await fs.readFile(join(f.destination, 'Contents/version'), 'utf8'), 'old');
    assert.equal(f.state.spawned.length, 0);
    assert.deepEqual(await fs.readdir(join(f.home, 'Applications')), ['Arara Code.app']);
  });
}

test('installs a stopped application without Finder', async t => {
  const f = await fixture(t);
  await installMacDmg('/cache/update.dmg', 'arara-code', f.options, f.deps);
  assert.equal(await fs.readFile(join(f.destination, 'Contents/version'), 'utf8'), 'new');
  assert.ok(f.calls.some(([cmd, args]) => cmd === '/usr/bin/open' && args[0] === f.destination));
});

test('rejects identity mismatches and symlink destinations before replacing files', async t => {
  const f = await fixture(t); f.state.id = 'unexpected';
  await assert.rejects(installMacDmg('/cache/update.dmg', 'arara-code', f.options, f.deps), /identity/);
  await fs.rename(f.destination, f.destination + '.saved'); await fs.symlink(f.destination + '.saved', f.destination);
  await assert.rejects(installMacDmg('/cache/update.dmg', 'arara-code', f.options, f.deps), /Unsafe/);
});

test('can update the managed Code host without opening a regular editor window', async t => {
  const f = await fixture(t);
  await installMacDmg('/cache/update.dmg', 'arara-code', { ...f.options, open: false }, f.deps);
  assert.equal(await fs.readFile(join(f.destination, 'Contents/version'), 'utf8'), 'new');
  assert.ok(!f.calls.some(([command]) => command === '/usr/bin/open'));
});
