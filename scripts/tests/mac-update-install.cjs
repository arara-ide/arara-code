'use strict';

const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, mkdir, writeFile, readFile, access, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { once } = require('node:events');
const { SWAP_SCRIPT } = require('../../extensions/arara-update/src/mac-install');

(async () => {
  assert.equal(process.platform, 'darwin', 'Run this integration test on macOS');
  const directory = await mkdtemp(join(tmpdir(), 'arara-mac-swap-'));
  const destination = join(directory, 'Applications', 'Arara Fixture.app');
  const stage = join(directory, 'Applications', '.staging');
  const incoming = join(stage, 'incoming.app');
  const marker = join(directory, 'reopened');
  const parent = spawn('/bin/sleep', ['60']); await once(parent, 'spawn');
  let helper;
  try {
    await mkdir(destination, { recursive: true }); await writeFile(join(destination, 'old'), 'previous');
    await mkdir(join(incoming, 'Contents/MacOS'), { recursive: true });
    const source = join(directory, 'fixture.c');
    await writeFile(source, '#include <stdio.h>\nint main(int argc, char **argv) { FILE *f = fopen("' + marker + '", "w"); if (!f) return 1; fputs("reopened", f); fclose(f); return 0; }\n');
    await promisify(execFile)('/usr/bin/clang', [source, '-o', join(incoming, 'Contents/MacOS/fixture')]);
    await writeFile(join(incoming, 'Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>br.app.code.arara.update-fixture</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>');
    const script = join(stage, 'install.sh'); await writeFile(script, SWAP_SCRIPT);
    helper = spawn('/bin/bash', [script, stage, destination, String(parent.pid)], { stdio: ['ignore', 'pipe', 'pipe'] });
    const completion = once(helper, 'exit');
    assert.equal(await readFile(join(destination, 'old'), 'utf8'), 'previous');
    await assert.rejects(access(marker));
    const stopped = once(parent, 'exit'); parent.kill(); await stopped;
    const [code] = await completion; assert.equal(code, 0);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !await access(marker).then(() => true, () => false)) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await readFile(marker, 'utf8'), 'reopened');
    await assert.rejects(access(join(destination, 'old')));
    console.log('PASS: native Mac helper waits for exit, swaps an isolated application and reopens it without Finder');
  } finally { parent.kill(); helper?.kill(); await rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
