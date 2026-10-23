// Called only by the serialized publish job. Builds never publish from development.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const packageName = name => /^[\w.+-]+\.(?:deb|tar\.gz|exe|zip)$/.test(name);
const digestOf = file => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(file);
  stream.on('error', reject);
  stream.on('data', chunk => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});
const assetDigest = asset => /^sha256:([a-f0-9]{64})$/.exec(asset.digest || '')?.[1];

function releaseNotes(version, names, changelog, prerelease) {
  const sections = [...changelog.matchAll(/^## \[([^\]]+)\][^\n]*\n([\s\S]*?)(?=^## \[|(?![\s\S]))/gm)];
  const changes = sections.find(s => s[1] === version) || sections.find(s => s[1] === 'Não lançado');
  const lines = [prerelease ? 'Versão de teste.' : `Arara Code ${version}.`, '', changes?.[2].trim() || '', '',
    'Os arquivos de cada plataforma aparecem aqui assim que o respectivo build termina.',
    'Confira os downloads disponíveis abaixo; outras plataformas ainda podem estar em processamento.', ''];
  if (names.some(n => n.endsWith('.deb'))) lines.push(
    '### Instalar ou atualizar (Ubuntu/Debian)', 'Baixe o `.deb` abaixo e rode:', '',
    `    sudo apt install ./arara-code_${version}_amd64.deb`, '',
    'Para atualizar, é o mesmo comando com o arquivo novo. Suas configurações ficam.', '',
    '### Desinstalar', '', '    arara-code-uninstall          # mantém configurações',
    '    arara-code-uninstall --all    # apaga tudo', '');
  if (names.some(n => n.endsWith('.exe'))) lines.push(
    '### Windows (teste)',
    `Baixe \`AraraCodeUserSetup-x64-${version}.exe\` (só para o seu usuário) ou \`AraraCodeSetup-x64-${version}.exe\` (todos os usuários) e execute.`,
    'Também há o `.zip`, sem instalar. O instalador ainda não é assinado: o Windows pode avisar.', '');
  const mac = names.filter(n => n.includes('-darwin-'));
  if (mac.length) lines.push('### macOS (teste)',
    ...mac.map(n => `Baixe \`${n}\` (${n.includes('-arm64-') ? 'Apple Silicon' : 'Intel'}).`),
    'Descompacte e arraste o app para Aplicativos. O app não é notarizado. Na primeira vez, rode no Terminal:', '',
    '    xattr -cr "/Applications/Arara Code.app"', '');
  return lines.join('\n');
}

async function publish({ env = process.env, dist = 'dist', changelog = 'CHANGELOG.md',
  gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } = {}) {
  const version = env.RELEASE_VERSION;
  const repo = env.GITHUB_REPOSITORY;
  const sha = env.GITHUB_SHA;
  const prerelease = env.PRERELEASE !== 'false';
  if (env.GITHUB_REF !== 'refs/heads/main') throw new Error('Releases are allowed only from main');
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || !/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^[a-f0-9]{40}$/.test(sha || '')) {
    throw new Error('Invalid release version, repository or commit');
  }
  const files = fs.readdirSync(dist).sort();
  if (!files.length || files.some(name => !packageName(name) || !name.includes(version) || !fs.statSync(path.join(dist, name)).isFile())) {
    throw new Error('Expected only packages for this version in dist');
  }
  const hashes = new Map();
  for (const name of files) hashes.set(name, await digestOf(path.join(dist, name)));
  const endpoint = `repos/${repo}/releases`;
  const readRelease = () => JSON.parse(gh(['api', `${endpoint}/tags/${version}`]));
  const assetsFor = release => {
    const assets = [];
    for (let page = 1; ; page++) {
      const batch = JSON.parse(gh(['api', `${endpoint}/${release.id}/assets?per_page=100&page=${page}`]));
      assets.push(...batch);
      if (batch.length < 100) return assets;
    }
  };
  let release;
  try {
    release = readRelease();
  } catch (error) {
    // Authentication/network/server errors must never be interpreted as a missing release.
    if (!String(error.stderr || '').includes('(HTTP 404)')) throw error;
  }
  if (release && (release.target_commitish !== sha || release.immutable || release.prerelease !== prerelease)) {
    throw new Error('Existing release has a different commit, immutability or prerelease setting');
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-release-'));
  try {
    const notes = path.join(scratch, 'release-notes.md');
    const changes = fs.readFileSync(changelog, 'utf8');
    fs.writeFileSync(notes, releaseNotes(version, files, changes, prerelease));
    if (!release) {
      gh(['release', 'create', version, '--repo', repo, '--target', sha, '--draft',
        '--title', `Arara Code ${version}`, '--notes-file', notes, ...(prerelease ? ['--prerelease'] : [])]);
      release = readRelease();
    }
    let assets = assetsFor(release);
    const hashOfAsset = async asset => {
      const digest = assetDigest(asset);
      if (digest) return digest;
      // Older assets may lack GitHub's digest. Hash the downloaded bytes in that case.
      const dir = fs.mkdtempSync(path.join(scratch, 'asset-'));
      gh(['release', 'download', version, '--repo', repo, '--pattern', asset.name, '--dir', dir]);
      return digestOf(path.join(dir, asset.name));
    };
    for (const name of files) {
      const existing = assets.find(a => a.name === name && a.state === 'uploaded');
      if (existing) {
        if (await hashOfAsset(existing) !== hashes.get(name)) throw new Error(`Refusing to replace different published bytes: ${name}`);
        continue;
      }
      // A failed GitHub upload can leave an empty starter asset; remove only that entry.
      const starter = assets.find(a => a.name === name && a.state === 'starter');
      if (starter) gh(['api', '--method', 'DELETE', `${endpoint}/assets/${starter.id}`]);
      gh(['release', 'upload', version, path.join(dist, name), '--repo', repo]);
    }
    assets = assetsFor(release).filter(a => a.state === 'uploaded' && packageName(a.name) && a.name.includes(version));
    assets.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    const sums = [];
    for (const asset of assets) {
      const hash = await hashOfAsset(asset);
      if (hashes.has(asset.name) && hashes.get(asset.name) !== hash) throw new Error(`Uploaded digest mismatch: ${asset.name}`);
      sums.push(`${hash}  ${asset.name}\n`);
    }
    if (files.some(name => !assets.some(a => a.name === name))) throw new Error('Uploaded package is missing from the release');
    const checksums = path.join(scratch, 'SHA256SUMS');
    fs.writeFileSync(checksums, sums.join(''));
    gh(['release', 'upload', version, checksums, '--repo', repo, '--clobber']);
    fs.writeFileSync(notes, releaseNotes(version, assets.map(a => a.name), changes, prerelease));
    // First publisher exposes the release only after its packages and checksums exist.
    // Later publishers leave its release date/latest status untouched.
    gh(['release', 'edit', version, '--repo', repo, '--notes-file', notes, ...(release.draft ? ['--draft=false'] : [])]);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

module.exports = { publish, releaseNotes };
if (require.main === module) publish().catch(error => {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
});
