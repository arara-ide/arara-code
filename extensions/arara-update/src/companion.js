'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { createReadStream, createWriteStream, existsSync } = require('node:fs');
const { mkdir, readFile, rename, unlink } = require('node:fs/promises');
const { homedir } = require('node:os');
const { join, basename } = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

function installedCompanion(product, platform = process.platform, home = homedir(), env = process.env, exists = existsSync) {
  const name = product === 'arara-code' ? 'Arara Code' : 'Arara Vibes';
  const candidates = platform === 'darwin' ? [`/Applications/${name}.app`, join(home, 'Applications', `${name}.app`)]
    : platform === 'win32' ? [join(env.LOCALAPPDATA || home, 'Programs', product, `${name}.exe`), join(env.ProgramFiles || 'C:\\Program Files', name, `${name}.exe`)]
      : [`/usr/bin/${product}`, `/opt/${name}/${product}`, join(home, '.local', 'bin', product)];
  return candidates.find(exists);
}

function companionAsset(assets, product, platform, arch) {
  if (!['arara-code', 'arara-vibes'].includes(product) || !['x64', 'arm64'].includes(arch)) return undefined;
  const extension = platform === 'darwin' ? '.dmg' : platform === 'win32' ? '.exe' : platform === 'linux' ? '.AppImage' : undefined;
  if (!extension) return undefined;
  const matches = assets.filter(asset => typeof asset.name === 'string' && asset.name.endsWith(extension) && !/[\\/]/.test(asset.name));
  const compatible = asset => platform === 'darwin' && /universal/i.test(asset.name) || (arch === 'arm64' ? /arm64|aarch64/i.test(asset.name) : !/arm64|aarch64|ia32|armv7/i.test(asset.name));
  return matches.find(compatible);
}

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function prepareCompanion(product, options = {}) {
  if (!['arara-code', 'arara-vibes'].includes(product)) throw new Error('Unknown companion');
  const root = options.root || join(homedir(), '.arara', 'companion-downloads', product);
  const get = options.fetch || fetch;
  const signal = options.signal || AbortSignal.timeout(30 * 60_000);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const metadata = join(root, 'ready.json');
  try {
    const cached = JSON.parse(await readFile(metadata, 'utf8'));
    if (typeof cached.file === 'string' && basename(cached.file) === cached.file && /^[a-f0-9]{64}$/.test(cached.sha256) && await digest(join(root, cached.file)) === cached.sha256) return join(root, cached.file);
  } catch { }
  const base = `https://github.com/arara-ide/${product}/releases/download/`;
  const request = async url => {
    const response = await get(url, { signal, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Arara-Companion' } });
    if (!response.ok) throw new Error(`Companion download failed: HTTP ${response.status}`);
    return response;
  };
  const release = await (await request(`https://api.github.com/repos/arara-ide/${product}/releases/latest`)).json();
  if (release.draft || release.prerelease || !Array.isArray(release.assets)) throw new Error('Stable companion release unavailable');
  const asset = companionAsset(release.assets, product, options.platform || process.platform, options.arch || process.arch);
  const sums = release.assets.find(item => item.name === 'SHA256SUMS');
  if (!asset || !sums || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 2 * 1024 ** 3) throw new Error('Compatible companion installer unavailable');
  for (const item of [asset, sums]) {
    if (typeof item.browser_download_url !== 'string' || !item.browser_download_url.startsWith(base) || new URL(item.browser_download_url).search || new URL(item.browser_download_url).hash) throw new Error('Invalid companion release URL');
  }
  const checksums = await (await request(sums.browser_download_url)).text();
  const checksum = checksums.split(/\r?\n/).map(line => /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line)).find(match => match?.[2] === asset.name)?.[1]?.toLowerCase();
  if (!checksum) throw new Error('Companion checksum unavailable');
  const target = join(root, asset.name);
  const partial = join(root, `${randomUUID()}.partial`);
  try {
    const response = await request(asset.browser_download_url);
    if (!response.body) throw new Error('Empty companion download');
    let bytes = 0;
    const limit = new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; done(bytes > asset.size ? new Error('Companion download too large') : null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal });
    if (bytes !== asset.size || await digest(partial) !== checksum) throw new Error('Companion checksum mismatch');
    await rename(partial, target);
    const staging = join(root, `${randomUUID()}.json`);
    await require('node:fs/promises').writeFile(staging, JSON.stringify({ file: asset.name, sha256: checksum }), { mode: 0o600 });
    await rename(staging, metadata);
    return target;
  } finally { await unlink(partial).catch(() => undefined); }
}

module.exports = { installedCompanion, companionAsset, prepareCompanion };
