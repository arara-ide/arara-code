'use strict';

const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, mkdir, writeFile, readFile, access, rm, copyFile, readdir, cp } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { once } = require('node:events');
const { SWAP_SCRIPT, installMacDmg } = require('../../extensions/arara-update/src/mac-install');

async function checkGatekeeper(directory) {
  const run = promisify(execFile);
  const home = join(directory, 'manual');
  const payload = join(home, 'payload');
  const source = join(payload, 'Arara Code.app');
  const destination = join(home, 'Applications', 'Arara Code.app');
  const plist = '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.arara.code</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>';
  await mkdir(join(source, 'Contents/MacOS'), { recursive: true });
  await mkdir(join(destination, 'Contents'), { recursive: true });
  await writeFile(join(source, 'Contents/Info.plist'), plist);
  await writeFile(join(destination, 'Contents/Info.plist'), plist);
  await writeFile(join(destination, 'old'), 'previous');
  await copyFile('/usr/bin/true', join(source, 'Contents/MacOS/fixture'));
  await run('/usr/bin/codesign', ['--force', '--sign', '-', source]);
  await cp(source, destination, { recursive: true });
  const image = join(home, 'fixture.dmg');
  await run('/usr/bin/hdiutil', ['create', '-srcfolder', payload, '-volname', 'Arara Gatekeeper Fixture', '-fs', 'HFS+', '-format', 'UDZO', image]);
  await assert.rejects(installMacDmg(process.env.ARARA_UPDATE_DMG || image, 'arara-code', {
    home, appRoot: join(destination, 'Contents/Resources/app'), tmpdir: home, waitPid: process.pid,
  }), error => error.code === 'ERR_MAC_GATEKEEPER_REJECTED' && error.cause.code === 3);
  assert.equal(await readFile(join(destination, 'old'), 'utf8'), 'previous');
  assert.deepEqual(await readdir(join(home, 'Applications')), ['Arara Code.app']);
  assert.ok(!(await readdir(home)).some(name => name.startsWith('arara-install-')));
  console.log('PASS: real DMG, codesign and Gatekeeper rejection preserve the installed app and clean temporary files');
}

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
    await checkGatekeeper(directory);
  } finally { parent.kill(); helper?.kill(); await rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
