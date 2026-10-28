const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

function testTerminal(app) {
  const library = path.join(app, 'node_modules.asar/node-pty');
  const repair = path.join(app, 'resources/arara-terminal');
  const manifest = JSON.parse(fs.readFileSync(path.join(repair, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, JSON.parse(fs.readFileSync(path.join(library, 'package.json'), 'utf8')).version);
  assert.equal(manifest.platform, 'linux');
  assert.equal(manifest.arch, process.arch);
  assert.equal(manifest.glibc, '2.28');
  for (const native of [path.join(library, 'build/Release/pty.node'), path.join(repair, 'node-pty/build/Release/pty.node')]) {
    assert.equal(manifest.sha256, createHash('sha256').update(fs.readFileSync(native)).digest('hex'));
  }
  assert.ok(!fs.existsSync(path.join(library, 'prebuilds')), 'the terminal must load the corrected primary, without a fallback');
  for (const args of [[app], [app, path.join(repair, 'node-pty')]]) {
    const result = spawnSync(process.execPath, [path.join(repair, 'probe.cjs'), ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 12000,
    });
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /ARARA_PTY_OK/);
  }
  console.log('PASS: corrected primary and repair payload match; no fallback; interactive input, output, resize and clean exit.');
}

module.exports = { testTerminal };
if (require.main === module) testTerminal(path.resolve(process.argv[2]));
