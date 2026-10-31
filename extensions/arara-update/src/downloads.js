'use strict';

const { createHash } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { t } = require('./i18n');
const { newerVersion, versionPattern } = require('./version');

const INSTALLER_ENV = 'ARARA_UPDATE_INSTALLER';
const RELEASE_DOWNLOAD = 'https://github.com/arara-ide/arara-code/releases/download/';
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const STALE_STAGING_MS = 24 * 60 * 60_000;

function updateTarget(platform, arch, product, appRoot, debInstalled) {
  const format = platform === 'win32' ? (product.target === 'system' || product.target === 'user' ? 'system' : 'zip')
    : platform === 'darwin' ? 'zip'
      : product.araraInstallFormat === 'appimage' ? 'AppImage'
        : appRoot.startsWith('/usr/share/arara-code/') && debInstalled ? 'deb' : 'tar.gz';
  return { platform, arch, format };
}

function installerName(version, target) {
  if (!versionPattern.test(version)) throw new Error('Invalid release version');
  const { platform, arch, format } = target;
  if (!['x64', 'arm64', 'ia32', 'arm'].includes(arch)) throw new Error('Unsupported architecture');
  if (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) return `AraraCode-darwin-${arch}-${version}.zip`;
  if (platform === 'win32' && ['user', 'system'].includes(format)) return `AraraCodeSetup-${arch}-${version}.exe`;
  if (platform === 'win32' && format === 'zip') return `AraraCode-win32-${arch}-${version}.zip`;
  if (platform === 'linux') {
    if (format === 'AppImage' && ['x64', 'arm64'].includes(arch)) return `AraraCode-linux-${arch}-${version}.AppImage`;
    if (format === 'deb') return `arara-code_${version}_${({ x64: 'amd64', arm64: 'arm64', ia32: 'i386', arm: 'armhf' })[arch]}.deb`;
    if (format === 'tar.gz') return `arara-code-linux-${arch}-${version}.tar.gz`;
  }
  throw new Error('Unsupported update target');
}

function installInstructions(name) {
  if (name.endsWith('.AppImage')) return t('Close Arara Code and replace your previous AppImage with the downloaded file, keeping the same location and filename used by your shortcut. Then reopen the AppImage. Your settings are preserved.');
  if (name.endsWith('.exe')) return t('Open the selected installer and follow the steps to update Arara Code. Then reopen the app.');
  if (name.endsWith('.app')) return t('Close Arara Code, drag the AraraCode.app shown in Finder to Applications and choose Replace. Then reopen the app.');
  if (name.includes('-win32-') && name.endsWith('.zip')) return t('Close Arara Code, extract the downloaded ZIP and replace the portable installation folder. Keep your data folder if present. Then reopen Arara Code.');
  if (name.endsWith('.zip')) return t('Extract the selected file. Close Arara Code, drag the new app to Applications and confirm replacement. Then reopen the app.');
  if (name.endsWith('.deb')) return t('Open the selected .deb package and choose Install/Update. If no installer opens, run in the terminal: sudo apt install ./{0}. Then reopen Arara Code.', name);
  return t('Extract the selected file. Close Arara Code and replace the installation folder with the extracted content. Then reopen the app.');
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const DRIVES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function windowsPowerShell(systemRoot = process.env.SystemRoot) {
  const root = String(systemRoot ?? '').toUpperCase().replace(/\\+$/, '');
  const drive = [...DRIVES].find(letter => root === `${letter}:\\WINDOWS`) ?? 'C';
  return `${drive}:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

function installAction(file, platform = process.platform, version, home, systemRoot) {
  if (platform === 'darwin' && file.endsWith('.zip') && version && home && versionPattern.test(version)) return { kind: 'extract-reveal', destination: join(home, 'Downloads', `AraraCode-${version}`) };
  if (platform === 'linux' && file.endsWith('.deb')) return { kind: 'terminal', text: `sudo apt install ${shellQuote(file)}` };
  if (platform === 'win32' && file.endsWith('.exe')) return {
    kind: 'open',
    command: windowsPowerShell(systemRoot),
    args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `(Start-Process -FilePath $env:${INSTALLER_ENV} -PassThru).WaitForExit()`],
    env: { [INSTALLER_ENV]: file },
  };
  if (platform === 'darwin' && (file.endsWith('.dmg') || file.endsWith('.pkg'))) return { kind: 'open', command: '/usr/bin/open', args: ['-W', file] };
  return { kind: 'reveal' };
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

class UpdateDownloads {
  constructor(root, target, fetchImpl = fetch) {
    this.root = root;
    this.target = target;
    this.fetchImpl = fetchImpl;
  }

  async cached(version) {
    const name = installerName(version, this.target);
    const dir = join(this.root, version);
    const file = join(dir, name);
    try {
      const metadata = JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8'));
      if (!(await lstat(file)).isFile() || !metadata.sha256 || await sha256(file) !== metadata.sha256) return null;
      if (this.target.format === 'AppImage') await chmod(file, 0o755);
      return { version, file };
    } catch {
      return null;
    }
  }

  async startup(current) {
    let ready = null;
    for (const entry of await readdir(this.root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.download-')) {
        const path = join(this.root, entry.name);
        const info = await lstat(path).catch(() => null);
        if (info && Date.now() - info.mtimeMs > STALE_STAGING_MS) await rm(path, { recursive: true, force: true });
        continue;
      }
      if (!versionPattern.test(entry.name)) continue;
      if (!newerVersion(entry.name, current)) {
        await rm(join(this.root, entry.name), { recursive: true, force: true });
      } else {
        const cached = await this.cached(entry.name);
        if (cached && (!ready || newerVersion(cached.version, ready.version))) ready = cached;
      }
    }
    await rmdir(this.root).catch(() => {});
    return ready;
  }

  async prepare(version, signal) {
    for (const entry of await readdir(this.root, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && newerVersion(version, entry.name)) await rm(join(this.root, entry.name), { recursive: true, force: true });
    }
    const existing = await this.cached(version);
    if (existing) return existing;
    const name = installerName(version, this.target);
    const base = `${RELEASE_DOWNLOAD}${version}/`;
    const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const sums = await this.fetchImpl(`${base}SHA256SUMS`, { signal: requestSignal });
    if (!sums.ok) throw new Error(`Checksums HTTP ${sums.status}`);
    const checksum = (await sums.text()).split(/\r?\n/).map(line => /^([a-fA-F0-9]{64})\s+\*?(?:\.\/)?(.+)$/.exec(line)).find(match => match?.[2] === name)?.[1].toLowerCase();
    if (!checksum) throw new Error('Installer not published for this platform');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const staging = await mkdtemp(join(this.root, '.download-'));
    try {
      const res = await this.fetchImpl(base + name, { signal: requestSignal });
      if (!res.ok || !res.body) throw new Error(`Installer HTTP ${res.status}`);
      const file = join(staging, name);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal: requestSignal });
      if (await sha256(file) !== checksum) throw new Error('Installer checksum mismatch');
      if (this.target.format === 'AppImage') await chmod(file, 0o755);
      await writeFile(join(staging, `${name}.json`), JSON.stringify({ sha256: checksum }));
      const destination = join(this.root, version);
      await mkdir(destination, { recursive: true, mode: 0o700 });
      await rename(file, join(destination, name));
      await rename(join(staging, `${name}.json`), join(destination, `${name}.json`));
      return { version, file: join(destination, name) };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

module.exports = { INSTALLER_ENV, UpdateDownloads, installAction, installInstructions, installerName, shellQuote, updateTarget, windowsPowerShell };
