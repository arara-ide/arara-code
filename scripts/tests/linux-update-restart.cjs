'use strict';

const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, writeFile, access, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { once } = require('node:events');
const { prepareLinuxRestart } = require('../../extensions/arara-update/src/linux-restart');

(async () => {
  assert.equal(process.platform, 'linux', 'Run this integration test on Linux with a systemd user manager');
  const directory = await mkdtemp(join(tmpdir(), 'arara-restart-test-'));
  const marker = join(directory, 'reopened');
  const executable = join(directory, 'new-editor');
  const parent = spawn('/bin/sleep', ['60']);
  await once(parent, 'spawn');
  try {
    await writeFile(executable, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
    await prepareLinuxRestart(parent.pid, { executable });
    await assert.rejects(access(marker));
    const exit = once(parent, 'exit'); parent.kill(); await exit;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await access(marker).then(() => true, () => false)) { console.log('PASS: independent systemd user service waits for the old process and launches the updated executable'); return; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Updated executable did not launch');
  } finally {
    parent.kill();
    await promisify(execFile)('/usr/bin/systemctl', ['--user', 'stop', `arara-code-restart-${parent.pid}.service`]).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
