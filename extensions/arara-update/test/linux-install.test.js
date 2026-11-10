'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { installAppImage, APPIMAGE_SWAP } = require('../src/linux-install');

for (const fail of [false, true]) test(`prepares the AppImage at its original path and preserves it on preparation failure=${fail}`, async t => {
  const root = await fs.mkdtemp(join(tmpdir(), 'arara-appimage-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const old = join(root, 'Arara Vibes.AppImage'); const incoming = join(root, 'download.AppImage');
  await fs.writeFile(old, 'old'); await fs.writeFile(incoming, 'new');
  const calls = [];
  const run = async (...args) => { calls.push(args); if (fail) throw Error('No user manager'); };
  const operation = installAppImage(incoming, old, 1234, { execFile: run, env: { DISPLAY: ':1', TOKEN: 'private' } });
  if (fail) await assert.rejects(operation, /user manager/); else await operation;
  assert.equal(await fs.readFile(old, 'utf8'), 'old');
  const directories = (await fs.readdir(root)).filter(name => name.startsWith('.arara-appimage-'));
  assert.equal(directories.length, fail ? 0 : 1);
  if (!fail) {
    assert.equal(await fs.readFile(join(root, directories[0], 'install.sh'), 'utf8'), APPIMAGE_SWAP);
    assert.equal((await fs.stat(join(root, directories[0], 'incoming'))).mode & 0o777, 0o755);
    assert.equal(calls[0][0], '/usr/bin/systemd-run');
    assert.ok(!calls[0][1].join(' ').includes('private'));
  }
});

test('rejects invalid AppImage destinations and process identifiers', async () => {
  await assert.rejects(installAppImage('/download', '/old', 0), /Invalid/);
  await assert.rejects(installAppImage('relative', '/old', 1234), /Invalid/);
  await assert.rejects(installAppImage('/same', '/same', 1234), /Invalid/);
});

test('the swap helper preserves a normal quit of the updated application', { timeout: 12000 }, async t => {
  const { spawn, execFile } = require('node:child_process');
  const { once } = require('node:events');
  const { promisify } = require('node:util');
  const root = await fs.mkdtemp(join(tmpdir(), 'arara-appimage-swap-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = join(root, 'Vibes.AppImage'); const stage = join(root, 'stage'); const marker = join(root, 'started');
  await fs.mkdir(stage); await fs.writeFile(destination, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await fs.writeFile(join(stage, 'incoming'), `#!/bin/sh\nprintf started > '${marker}'\nexit 0\n`, { mode: 0o755 });
  const script = join(stage, 'install.sh'); await fs.writeFile(script, APPIMAGE_SWAP);
  const parent = spawn('/bin/sleep', ['60']); await once(parent, 'spawn');
  const done = promisify(execFile)('/bin/sh', [script, stage, destination, String(parent.pid)]);
  const exited = once(parent, 'exit'); parent.kill(); await exited;
  await done;
  assert.equal(await fs.readFile(marker, 'utf8'), 'started');
  assert.ok((await fs.readFile(destination, 'utf8')).includes('exit 0'));
  await assert.rejects(fs.access(stage));
});
