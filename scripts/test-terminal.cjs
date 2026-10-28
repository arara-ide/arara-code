const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

function copyLibrary(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const file of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, file.name);
    const to = path.join(destination, file.name);
    if (file.isDirectory()) copyLibrary(from, to);
    else fs.writeFileSync(to, fs.readFileSync(from));
  }
}

function exercise(library) {
  const source = `const pty = require(process.argv[1]);
const t = pty.spawn('/bin/bash', ['--noprofile', '--norc', '-c', 'test -t 0 && test -t 1 && read -r value && stty size && printf "\\036%s\\037" "$value"'], { cwd: process.argv[2], env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color' }, cols: 80, rows: 24 });
let output = '';
const timeout = setTimeout(() => { t.kill(); process.exit(2); }, 8000);
t.onData(data => { output += data; });
t.onExit(event => { clearTimeout(timeout); console.log(JSON.stringify({ ...event, output })); process.exit(event.exitCode === 0 && output.includes('31 97') && output.includes('\\x1eARARA_TERMINAL_OK\\x1f') ? 0 : 1); });
t.resize(97, 31);
t.write('ARARA_TERMINAL_OK\\r');`;
  return spawnSync(process.execPath, ['-e', source, library, os.tmpdir()], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 12000,
  });
}

function testTerminal(app) {
  const library = path.join(app, 'node_modules.asar/node-pty');
  const fallback = path.join(library, 'prebuilds', `linux-${process.arch}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(fallback, 'arara-fallback.json'), 'utf8'));
  assert.equal(manifest.version, JSON.parse(fs.readFileSync(path.join(library, 'package.json'), 'utf8')).version);
  assert.equal(manifest.platform, 'linux');
  assert.equal(manifest.arch, process.arch);
  assert.equal(manifest.glibc, '2.28');
  assert.equal(manifest.sha256, createHash('sha256').update(fs.readFileSync(path.join(fallback, 'pty.node'))).digest('hex'));
  const expectWorking = location => {
    const result = exercise(location);
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  };
  expectWorking(library);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arara terminal recovery '));
  try {
    const isolated = path.join(directory, 'node-pty');
    copyLibrary(library, isolated);
    const release = path.join(isolated, 'build/Release/pty.node');
    fs.mkdirSync(path.dirname(release), { recursive: true });
    fs.writeFileSync(release, 'incompatible native module');
    expectWorking(isolated);
    fs.rmSync(release);
    expectWorking(isolated);
    fs.writeFileSync(path.join(isolated, 'prebuilds', `linux-${process.arch}`, 'pty.node'), 'corrupt fallback');
    const failed = exercise(isolated);
    assert.notEqual(failed.status, 0, 'an unusable reserve must not pass the terminal check');
    assert.ok(!failed.error, `the failed loader must exit without hanging: ${failed.error}`);
    console.log('PASS: packaged PTY; automatic recovery from invalid/missing primary; interactive input, output, resize and clean exit; unusable reserve rejected.');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

module.exports = { testTerminal };
if (require.main === module) {
  if (process.platform !== 'linux') throw new Error('The terminal fallback check requires Linux.');
  testTerminal(path.resolve(process.argv[2]));
}
