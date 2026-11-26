#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EXTENSIONS } = require('./extension-layout.cjs');

const DEFAULT_API = 'https://api.code.app.br';
const AUDIENCE = 'arara-components';
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const ENGINE = /^(?:\^|>=)?\d{1,6}\.\d{1,6}\.\d{1,6}$/;

const xml = value => String(value).replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]);

function componentManifest(name, staged) {
  if (!EXTENSIONS.includes(name)) throw new Error(`Unknown component: ${name}. Use ${EXTENSIONS.join(', ')}.`);
  const manifest = JSON.parse(fs.readFileSync(path.join(staged, 'package.json'), 'utf8'));
  if (manifest.publisher !== 'arara' || manifest.name !== name) throw new Error(`Expected the arara.${name} manifest`);
  if (!VERSION.test(manifest.version ?? '')) throw new Error(`Invalid version: ${manifest.version}`);
  if (!ENGINE.test(manifest.engines?.vscode ?? '')) throw new Error(`Invalid engines.vscode: ${manifest.engines?.vscode}`);
  return manifest;
}

function vsixManifest(manifest) {
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(manifest.name)}" Version="${xml(manifest.version)}" Publisher="${xml(manifest.publisher)}" />
    <DisplayName>${xml(manifest.displayName ?? manifest.name)}</DisplayName>
    <Description xml:space="preserve">${xml(manifest.description ?? '')}</Description>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(manifest.engines.vscode)}" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="utf-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json" /><Default Extension=".vsixmanifest" ContentType="text/xml" /></Types>\n';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function packageComponent(name, staged, output, spawn = spawnSync) {
  const manifest = componentManifest(name, staged);
  const work = fs.mkdtempSync(path.join(path.dirname(path.resolve(output)), '.component-'));
  try {
    fs.cpSync(staged, path.join(work, 'extension'), { recursive: true, verbatimSymlinks: true });
    fs.writeFileSync(path.join(work, 'extension.vsixmanifest'), vsixManifest(manifest));
    fs.writeFileSync(path.join(work, '[Content_Types].xml'), CONTENT_TYPES);
    fs.rmSync(output, { force: true });
    const result = spawn('zip', ['-q', '-r', '-X', path.resolve(output), '[Content_Types].xml', 'extension.vsixmanifest', 'extension'], { cwd: work, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`zip failed (exit ${result.status})`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  const metadata = { name, id: `arara.${name}`, version: manifest.version, engine: manifest.engines.vscode, sha256: sha256(output), size: fs.statSync(output).size };
  fs.writeFileSync(`${output}.json`, JSON.stringify(metadata, null, 2) + '\n');
  return metadata;
}

async function oidcToken(env = process.env, fetchImpl = fetch) {
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error('GitHub OIDC is unavailable: grant the job permissions.id-token: write');
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience', AUDIENCE);
  const response = await fetchImpl(url.href, { headers: { authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`, accept: 'application/json' } });
  if (!response.ok) throw new Error(`GitHub OIDC HTTP ${response.status}`);
  const { value } = await response.json();
  if (typeof value !== 'string' || !value) throw new Error('GitHub OIDC returned no token');
  return value;
}

async function publishComponent(vsix, { api = DEFAULT_API, env = process.env, fetchImpl = fetch } = {}) {
  const metadata = JSON.parse(fs.readFileSync(`${vsix}.json`, 'utf8'));
  if (!EXTENSIONS.includes(metadata.name) || !VERSION.test(metadata.version) || !ENGINE.test(metadata.engine)) throw new Error('Invalid component metadata');
  if (sha256(vsix) !== metadata.sha256 || fs.statSync(vsix).size !== metadata.size) throw new Error('Package does not match its metadata');
  const origin = new URL(api);
  if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Publish only over HTTPS');
  const url = new URL(`/v1/ide/components/${metadata.name}/releases`, origin);
  for (const key of ['version', 'engine', 'sha256']) url.searchParams.set(key, metadata[key]);
  const token = await oidcToken(env, fetchImpl);
  const response = await fetchImpl(url.href, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'content-length': String(metadata.size) },
    body: fs.createReadStream(vsix),
    duplex: 'half',
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 201) return { status: 'published', ...metadata };
  if (response.status === 409 && body.code === 'component_version_not_newer') return { status: 'unchanged', ...metadata };
  throw new Error(`Publish failed: HTTP ${response.status} ${body.message ?? ''}`.trim());
}

module.exports = { AUDIENCE, componentManifest, oidcToken, packageComponent, publishComponent, vsixManifest };

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  const usage = 'Usage: node component-release.cjs package <arara-ai|arara-bot|arara-orchestra> <staged-dir> <out.vsix> | publish <out.vsix> [api-url]';
  (async () => {
    if (command === 'package' && args.length === 3) {
      console.log(JSON.stringify(packageComponent(args[0], path.resolve(args[1]), path.resolve(args[2]))));
    } else if (command === 'publish' && (args.length === 1 || args.length === 2)) {
      const result = await publishComponent(path.resolve(args[0]), { api: args[1] || DEFAULT_API });
      if (result.status === 'unchanged') console.log(`::notice::${result.id} ${result.version} is already published. Bump package.json version to release it to installed IDEs.`);
      else console.log(`Published ${result.id} ${result.version} (${result.sha256})`);
    } else {
      throw new Error(usage);
    }
  })().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
