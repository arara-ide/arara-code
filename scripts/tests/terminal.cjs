const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { prepareTerminal, validateNative } = require('../prepare-terminal.cjs');

const root = path.resolve(__dirname, '../..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arara terminal preparation '));
const library = path.join(directory, 'node_modules/node-pty');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };

(async () => {
  const arch = process.arch;
  const native = path.join(directory, 'baseline.node');
  const source = path.join(directory, 'baseline.c');
  const glibc = arch === 'x64' ? '2.2.5' : '2.17';
  write(source, `#include <termios.h>\n__asm__(".symver cfsetospeed,cfsetospeed@GLIBC_${glibc}");\nint terminal_speed(struct termios *t) { return cfsetospeed(t, B9600); }\n`);
  execFileSync('cc', ['-shared', '-fPIC', source, '-o', native]);
  const hash = validateNative(native, arch);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.throws(() => validateNative(native, arch === 'x64' ? 'arm64' : 'x64'), /Invalid .* ELF/);
  assert.throws(() => validateNative(native, 'unsupported'), /Unsupported/);
  write(path.join(directory, 'corrupt.node'), 'not an ELF');
  assert.throws(() => validateNative(path.join(directory, 'corrupt.node'), arch), /Invalid .* ELF/);
  for (const name of ['GLIBC_2.42', 'GLIBCXX_3.4.30', 'CXXABI_1.3.15']) {
    assert.throws(() => validateNative(native, arch, () => `Name: ${name}`), /Terminal module requires/);
  }
  assert.equal(validateNative(native, arch, () => 'Name: GLIBC_2.28\nName: GLIBCXX_3.4.25\nName: CXXABI_1.3.9'), hash);
  write(path.join(library, 'package.json'), JSON.stringify({ name: 'node-pty', version: '1.2.0-beta.15' }));
  write(path.join(library, 'binding.gyp'), '{}');
  write(path.join(library, 'src/unix/pty.cc'), 'native source');
  write(path.join(library, 'lib/index.js'), 'module.exports = {};');
  write(path.join(library, 'prebuilds/linux-x64/pty.node'), 'legacy fallback');
  write(path.join(library, 'node_modules/node-addon-api/package.json'), '{"name":"node-addon-api"}');
  write(path.join(directory, 'build/gyp/node_modules/node-gyp/bin/node-gyp.js'), '');
  write(path.join(library, 'build/Release/pty.node'), 'original primary');
  let builds = 0;
  const options = {
    arch,
    getSysroot: async debian => {
      assert.equal(debian, arch === 'x64' ? 'amd64' : 'arm64');
      return path.join(directory, 'toolchain', 'triple', 'triple', 'sysroot');
    },
    run: (command, args, opts) => {
      if (command === 'readelf') return execFileSync(command, args, opts);
      builds++;
      assert.equal(command, process.execPath);
      assert.ok(args.includes(`--arch=${arch}`));
      assert.equal(opts.env.npm_config_build_from_source, 'true');
      assert.ok(opts.env.CC.endsWith('-gcc'));
      assert.ok(opts.env.CXX.endsWith('-g++'));
      assert.equal(opts.env.CFLAGS, opts.env.LDFLAGS);
      assert.ok(fs.existsSync(path.join(opts.cwd, 'node_modules/node-addon-api/package.json')));
      assert.equal(fs.readFileSync(path.join(opts.cwd, 'src/unix/pty.cc'), 'utf8'), 'native source');
      write(path.join(opts.cwd, 'build/Release/pty.node'), fs.readFileSync(native));
    },
  };
  const output = await prepareTerminal(directory, options);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest, { version: '1.2.0-beta.15', platform: 'linux', arch, glibc: '2.28', sha256: hash });
  const payload = path.join(output, 'node-pty/build/Release/pty.node');
  assert.equal(validateNative(payload, arch), hash);
  assert.equal(validateNative(path.join(library, 'build/Release/pty.node'), arch), hash);
  assert.ok(!fs.existsSync(path.join(library, 'prebuilds')));
  assert.ok(fs.existsSync(path.join(output, 'probe.cjs')));
  await prepareTerminal(directory, options);
  assert.equal(builds, 2);
  assert.equal(validateNative(payload, arch), hash);
  await assert.rejects(prepareTerminal(directory, { ...options, run: () => { throw Error('compiler failed'); } }), /compiler failed/);
  assert.equal(validateNative(payload, arch), hash);
  assert.ok(!fs.readdirSync(library).some(name => name.startsWith('.arara-terminal-')));
  const build = fs.readFileSync(path.join(root, 'scripts/build.sh'), 'utf8');
  assert.ok(build.includes('prepare-terminal.cjs'));
  assert.ok(build.indexOf('prepare-terminal.cjs') < build.indexOf('vscode-min-prepack'));
  assert.ok(build.indexOf('scripts/test-terminal.cjs') < build.indexOf('tar czf'));
  console.log('PASS: ELF/architecture and ABI limits; isolated source build; version/hash metadata; primary corrected; fallback removed; failed preparation preserves payload; cleanup and release gates.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
