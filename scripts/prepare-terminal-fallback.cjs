const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const targets = {
  x64: { debian: 'amd64', triple: 'x86_64-linux-gnu', machine: 62 },
  arm64: { debian: 'arm64', triple: 'aarch64-linux-gnu', machine: 183 },
};

function newerVersion(version, maximum) {
  const left = version.split('.').map(Number);
  const right = maximum.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) > (right[i] || 0);
  }
  return false;
}

function validateNative(file, arch, run = execFileSync) {
  const target = targets[arch];
  if (!target) throw new Error(`Unsupported terminal fallback architecture: ${arch}`);
  const binary = fs.readFileSync(file);
  if (binary.length < 20 || binary.subarray(0, 4).toString('hex') !== '7f454c46' || binary[4] !== 2 || binary[5] !== 1 || binary.readUInt16LE(18) !== target.machine) {
    throw new Error(`Invalid ${arch} terminal fallback ELF: ${file}`);
  }
  const versions = run('readelf', ['--version-info', file], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  const maximum = { GLIBC: '2.28', GLIBCXX: '3.4.25', CXXABI: '1.3.9' };
  for (const match of versions.matchAll(/\bName: (GLIBC|GLIBCXX|CXXABI)_([\d.]+)/g)) {
    if (newerVersion(match[2], maximum[match[1]])) throw new Error(`Terminal fallback requires ${match[1]}_${match[2]} > ${maximum[match[1]]}`);
  }
  return createHash('sha256').update(binary).digest('hex');
}

async function prepareTerminalFallback(vscode, { arch = process.arch, run = execFileSync, getSysroot } = {}) {
  const target = targets[arch];
  if (!target) throw new Error(`Unsupported terminal fallback architecture: ${arch}`);
  const library = path.join(vscode, 'node_modules/node-pty');
  const version = JSON.parse(fs.readFileSync(path.join(library, 'package.json'), 'utf8')).version;
  if (!getSysroot) {
    const installer = await import(pathToFileURL(path.join(vscode, 'build/linux/debian/install-sysroot.ts')).href);
    getSysroot = installer.getVSCodeSysroot;
  }
  const sysroot = await getSysroot(target.debian);
  const toolchain = path.resolve(sysroot, '../..');
  const stage = fs.mkdtempSync(path.join(library, '.arara-fallback-'));
  try {
    for (const file of ['package.json', 'binding.gyp', 'src']) fs.cpSync(path.join(library, file), path.join(stage, file), { recursive: true });
    const addon = path.dirname(require.resolve('node-addon-api/package.json', { paths: [library] }));
    fs.mkdirSync(path.join(stage, 'node_modules'), { recursive: true });
    fs.cpSync(addon, path.join(stage, 'node_modules/node-addon-api'), { recursive: true });
    const gyp = require.resolve('node-gyp/bin/node-gyp.js', { paths: [path.join(vscode, 'build/gyp'), vscode] });
    const env = { ...process.env,
      CC: path.join(toolchain, 'bin', `${target.triple}-gcc`),
      CXX: path.join(toolchain, 'bin', `${target.triple}-g++`),
      CFLAGS: `--sysroot=${sysroot}`,
      CXXFLAGS: `--sysroot=${sysroot} -std=gnu++2a`,
      LDFLAGS: `--sysroot=${sysroot}`,
      SYSROOT_PATH: sysroot,
      npm_config_arch: arch,
      npm_config_build_from_source: 'true',
    };
    delete env.CPPFLAGS;
    run(process.execPath, [gyp, 'rebuild', `--arch=${arch}`, `--target=${process.versions.node}`, '--dist-url=https://nodejs.org/download/release'], { cwd: stage, env, stdio: 'inherit', timeout: 300000 });
    const native = path.join(stage, 'build/Release/pty.node');
    const sha256 = validateNative(native, arch, run);
    const output = path.join(library, 'prebuilds', `linux-${arch}`);
    fs.mkdirSync(output, { recursive: true });
    const staged = path.join(output, `.pty-${process.pid}.node`);
    fs.copyFileSync(native, staged);
    fs.renameSync(staged, path.join(output, 'pty.node'));
    fs.writeFileSync(path.join(output, 'arara-fallback.json'), JSON.stringify({ version, platform: 'linux', arch, glibc: '2.28', sha256 }) + '\n');
    return output;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

module.exports = { prepareTerminalFallback, validateNative };
if (require.main === module) {
  const vscode = process.argv[2];
  if (!vscode) throw new Error('Expected the Code-OSS source directory.');
  prepareTerminalFallback(path.resolve(vscode), { arch: process.argv[3] || process.arch }).catch(error => { console.error(error); process.exitCode = 1; });
}
