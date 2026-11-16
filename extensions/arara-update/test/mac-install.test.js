'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { EventEmitter } = require('node:events');
const { installMacDmg, macAppPids, macDestination, macMainPid, macUpdateRequirement, MAC_APP_RUNNING, SWAP_SCRIPT } = require('../src/mac-install');

async function fixture(t) {
  const home = await fs.mkdtemp(join(tmpdir(), 'arara-mac-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const destination = join(home, 'Applications', 'Arara Code.app');
  await fs.mkdir(join(destination, 'Contents'), { recursive: true });
  await fs.writeFile(join(destination, 'Contents/version'), 'old');
  const calls = [];
  const state = { fail: undefined, id: 'com.arara.code', spawned: [], requirement: '', rejectPolicy: false, failRequirement: false, processes: '' };
  const execFile = async (command, args) => {
    calls.push([command, args]);
    if (command === state.fail) throw new Error('Native command failed');
    if (command.endsWith('codesign') && args[0] === '--display') return { stderr: state.requirement };
    if (command.endsWith('codesign') && args.includes('-R') && state.failRequirement === (args.at(-1) === destination ? 'installed' : 'incoming')) throw new Error('Signing identity mismatch');
    if (command.endsWith('spctl') && state.rejectPolicy) throw Object.assign(new Error('rejected'), { code: 3 });
    if (command.endsWith('PlistBuddy')) return { stdout: state.id };
    if (command.endsWith('/ps')) return { stdout: state.processes.replaceAll('$DESTINATION', destination) };
    if (command.endsWith('hdiutil') && args[0] === 'attach') {
      const source = join(args[args.indexOf('-mountpoint') + 1], 'AraraCode.app', 'Contents');
      await fs.mkdir(source, { recursive: true }); await fs.writeFile(join(source, 'version'), 'new');
    }
    if (command.endsWith('hdiutil') && args[0] === 'detach') {
      await fs.rm(join(args[1], 'AraraCode.app'), { recursive: true });
    }
    if (command.endsWith('ditto')) await fs.cp(args.at(-2), args.at(-1), { recursive: true });
    if (command === '/bin/rm') await fs.rm(args.at(-1), { recursive: true, force: true });
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
  const run = async () => ({ stdout: '  123 1 /Applications/Arara Code.app/Contents/MacOS/Electron\n  456 123 /Applications/Arara Code.app/Contents/Frameworks/Helper\n' });
  assert.equal(await macMainPid('/Applications/Arara Code.app/Contents/Resources/app', run, 1), 123);
  const host = async () => ({ stdout: '  123 1 /Applications/Arara Code.app/Contents/MacOS/Electron\n  789 1 /Applications/Arara Code.app/Contents/MacOS/Electron\n' });
  assert.equal(await macMainPid('/Applications/Arara Code.app/Contents/Resources/app', host, 789), 789);
  await assert.rejects(macMainPid('/Applications/Arara Code.app/Contents/Resources/app', host, 1), /Application process unavailable/);
  await assert.rejects(macMainPid('/Applications/Arara Code.app/Contents/Resources/app', async () => ({ stdout: '' })));
});

test('follows the extension host ancestry when another process uses the same application bundle', async () => {
  const processes = [
    '  123 1 /Applications/Arara Code.app/Contents/MacOS/Arara Code',
    '  456 123 /Applications/Arara Code.app/Contents/Frameworks/Arara Code Helper (Plugin).app/Contents/MacOS/Arara Code Helper (Plugin)',
    '  789 1 /Applications/Arara Code.app/Contents/MacOS/Arara Code',
    '  890 789 /Applications/Arara Code.app/Contents/Frameworks/Arara Code Helper (Plugin).app/Contents/MacOS/Arara Code Helper (Plugin)',
    '  901 456 /usr/local/bin/node',
    '  902 789 /Applications/Arara Code.app/Contents/MacOS/Arara Code',
  ];
  const run = async (_command, args) => ({ stdout: processes.map(line => args.includes('pid=,comm=') ? line.replace(/^(\s*\d+)\s+\d+/, '$1') : line).join('\n') });
  const appRoot = '/Applications/Arara Code.app/Contents/Resources/app';
  assert.equal(await macMainPid(appRoot, run, 456), 123);
  assert.equal(await macMainPid(appRoot, run, 901), 123);
  assert.equal(await macMainPid(appRoot, run, 890), 789);
  assert.equal(await macMainPid(appRoot, run, 902), 902);
  await assert.rejects(macMainPid(appRoot, run, 999), /Application process unavailable/);
});

test('rejects missing or cyclic ancestry instead of choosing another application instance', async () => {
  const run = async () => ({ stdout: [
    '  123 1 /Applications/Arara Code.app/Contents/MacOS/Arara Code',
    '  789 1 /Applications/Arara Code.app/Contents/MacOS/Arara Code',
    '  456 457 /usr/local/bin/node',
    '  457 456 /usr/local/bin/node',
    'invalid process row',
  ].join('\n') });
  const appRoot = '/Applications/Arara Code.app/Contents/Resources/app';
  await assert.rejects(macMainPid(appRoot, run, 456), /Application process unavailable/);
  await assert.rejects(macMainPid(appRoot, run, 999), /Application process unavailable/);
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

test('identifies Gatekeeper rejection without replacing the app or hiding it behind cleanup errors', async t => {
  const f = await fixture(t);
  const rejected = Object.assign(new Error('rejected'), { code: 3 });
  const fixtureExec = f.deps.execFile;
  f.deps.execFile = async (command, args) => {
    if (command === '/usr/sbin/spctl') throw rejected;
    return fixtureExec(command, args);
  };
  f.deps.fs = { ...fs, rm: async () => { throw Object.assign(new Error('directory not empty'), { code: 'ENOTEMPTY' }); } };
  t.mock.method(console, 'warn', () => {});
  await assert.rejects(installMacDmg('/cache/update.dmg', 'arara-code', f.options, f.deps), error => error.code === 'ERR_MAC_GATEKEEPER_REJECTED' && error.cause === rejected);
  assert.equal(await fs.readFile(join(f.destination, 'Contents/version'), 'utf8'), 'old');
  assert.equal(f.state.spawned.length, 0);
});

test('preserves other Gatekeeper command failures and signature failures', async t => {
  for (const command of ['/usr/bin/codesign', '/usr/sbin/spctl']) {
    const f = await fixture(t);
    const failure = Object.assign(new Error('Native command failed'), { code: 1 });
    const run = f.deps.execFile;
    f.deps.execFile = async (cmd, args) => { if (cmd === command) throw failure; return run(cmd, args); };
    await assert.rejects(installMacDmg('/cache/update.dmg', 'arara-code', f.options, f.deps), error => error === failure);
    assert.equal(await fs.readFile(join(f.destination, 'Contents/version'), 'utf8'), 'old');
  }
});

test('extracts only a certificate-bound requirement for the expected product', () => {
  const requirement = `identifier "com.arara.code" and certificate leaf = H"${'a'.repeat(40)}"`;
  assert.equal(macUpdateRequirement(`Executable=/Applications/Arara Code.app\ndesignated => ${requirement}\n`, 'arara-code'), `=${requirement}`);
  for (const output of ['', 'designated => identifier "com.arara.code"', 'designated => cdhash H"abcd"',
    `designated => ${requirement} or true`, `designated => ${requirement}\ndesignated => ${requirement}`,
    `designated => identifier "com.arara.code" and certificate leaf = H"abc"`]) {
    assert.equal(macUpdateRequirement(output, 'arara-code'), null);
  }
  assert.equal(macUpdateRequirement(`designated => ${requirement}`, 'arara-vibes'), null);
  assert.equal(macUpdateRequirement(`designated => ${requirement}`, 'unknown'), null);
});

for (const running of [false, true]) {
  test(`automatically updates the same certificate despite initial-install policy rejection, running=${running}`, async t => {
    const f = await fixture(t);
    const requirement = `=identifier "com.arara.code" and certificate leaf = H"${'a'.repeat(40)}"`;
    f.state.requirement = `designated => ${requirement.slice(1)}`;
    f.state.rejectPolicy = true;
    await installMacDmg('/cache/update.dmg', 'arara-code', { ...f.options, ...(running ? { waitPid: 123 } : {}) }, f.deps);
    const checks = f.calls.filter(([command, args]) => command.endsWith('codesign') && args.includes('-R'));
    assert.equal(checks.length, 2);
    assert.equal(checks[0][1].at(-1), f.destination);
    for (const [, args] of checks) {
      assert.equal(args[args.indexOf('-R') + 1], requirement);
      assert.ok(args.includes('--all-architectures'));
    }
    assert.ok(checks[0][1].includes('--ignore-resources'));
    assert.ok(!checks[1][1].includes('--ignore-resources'));
    assert.ok(f.calls.some(([command, args]) => command.endsWith('codesign') && args.includes('--deep') && args.includes('--strict') && args.includes('--all-architectures')));
    assert.ok(!f.calls.some(([command]) => command.endsWith('spctl')));
    assert.equal(await fs.readFile(join(f.destination, 'Contents/version'), 'utf8'), running ? 'old' : 'new');
    assert.equal(f.state.spawned.length, running ? 1 : 0);
  });
}

for (const rejected of ['installed', 'incoming']) {
  test(`does not use Gatekeeper approval to accept an invalid ${rejected} signature`, async t => {
    const f = await fixture(t);
    f.state.requirement = `designated => identifier "com.arara.code" and certificate leaf = H"${'a'.repeat(40)}"`;
    f.state.failRequirement = rejected;
    await assert.rejects(installMacDmg('/cache/update.dmg', 'arara-code', f.options, f.deps), /Signing identity mismatch/);
    assert.equal(await fs.readFile(join(f.destination, 'Contents/version'), 'utf8'), 'old');
    assert.ok(!f.calls.some(([command]) => command.endsWith('spctl')));
    assert.equal(f.state.spawned.length, 0);
  });
}

test('new installations still require Gatekeeper approval', async t => {
  const f = await fixture(t);
  await fs.rm(f.destination, { recursive: true });
  f.state.rejectPolicy = true;
  await assert.rejects(installMacDmg('/cache/update.dmg', 'arara-code', f.options, f.deps), error => error.code === 'ERR_MAC_GATEKEEPER_REJECTED');
  await assert.rejects(fs.access(f.destination));
  assert.equal(f.state.spawned.length, 0);
});

test('lists only main executables of the application bundle', async () => {
  const run = async () => ({ stdout: '  12 1 /Applications/Arara Code.app/Contents/MacOS/Arara Code\n  13 12 /Applications/Arara Code.app/Contents/Frameworks/Arara Code Helper (Plugin).app/Contents/MacOS/Arara Code Helper (Plugin)\n  14 1 /Applications/Arara Code Copy.app/Contents/MacOS/Arara Code\n' });
  assert.deepEqual(await macAppPids('/Applications/Arara Code.app', run), [12]);
});

test('an open application blocks the direct installation with a stable code', async t => {
  const f = await fixture(t);
  f.state.processes = '  77 1 $DESTINATION/Contents/MacOS/Arara Code\n';
  await assert.rejects(installMacDmg('/cache/update.dmg', 'arara-code', { ...f.options, open: false }, f.deps), error => error.code === MAC_APP_RUNNING);
  assert.equal(await fs.readFile(join(f.destination, 'Contents/version'), 'utf8'), 'old');
  assert.ok(!f.calls.some(([command]) => command.endsWith('hdiutil')));
});

test('leftover helper processes of a closed application do not block the installation', async t => {
  const f = await fixture(t);
  f.state.processes = '  78 1 $DESTINATION/Contents/Frameworks/Arara Code Helper (Plugin).app/Contents/MacOS/Arara Code Helper (Plugin)\n';
  await installMacDmg('/cache/update.dmg', 'arara-code', { ...f.options, open: false }, f.deps);
  assert.equal(await fs.readFile(join(f.destination, 'Contents/version'), 'utf8'), 'new');
});

test('removes a failed stage with the native remover so Electron archives inside the bundle are deleted', async t => {
  const f = await fixture(t);
  f.state.fail = '/usr/bin/codesign';
  await assert.rejects(installMacDmg('/cache/update.dmg', 'arara-code', f.options, f.deps));
  const removals = f.calls.filter(([command]) => command === '/bin/rm');
  assert.equal(removals.length, 1);
  assert.match(removals[0][1].at(-1), /\.arara-install-/);
  assert.deepEqual(await fs.readdir(join(f.home, 'Applications')), ['Arara Code.app']);
});

test('a direct installation removes the previous copy after the new application is in place', async t => {
  const f = await fixture(t);
  await installMacDmg('/cache/update.dmg', 'arara-code', { ...f.options, open: false }, f.deps);
  assert.equal(await fs.readFile(join(f.destination, 'Contents/version'), 'utf8'), 'new');
  assert.deepEqual(await fs.readdir(join(f.home, 'Applications')), ['Arara Code.app']);
});
