#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const assets = ['StoreLogo.png', 'Square44x44Logo.png', 'Square150x150Logo.png'];

function msixVersion(release) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(release)?.slice(1).map(Number);
  if (!parts || parts.some(n => n > 65535)) throw new Error(`Version ${release} cannot be expressed as an MSIX version`);
  return `${parts.join('.')}.0`;
}

const xml = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

function manifest({ identityName, publisher, publisherDisplayName, version, product }) {
  const name = xml(product.nameLong);
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap rescap">
  <Identity Name="${xml(identityName)}" Publisher="${xml(publisher)}" Version="${version}" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>${name}</DisplayName>
    <PublisherDisplayName>${xml(publisherDisplayName)}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="pt-BR" />
    <Resource Language="en-US" />
    <Resource Language="es-ES" />
  </Resources>
  <Applications>
    <Application Id="AraraCode" Executable="${xml(product.nameShort)}.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="${name}" Description="${name}" BackgroundColor="transparent" Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png" />
      <Extensions>
        <uap:Extension Category="windows.protocol">
          <uap:Protocol Name="${xml(product.urlProtocol)}">
            <uap:DisplayName>${name}</uap:DisplayName>
          </uap:Protocol>
        </uap:Extension>
      </Extensions>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
`;
}

function filesUnder(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full, base) : [[full, path.relative(base, full)]];
  });
}

function makeappx() {
  const kits = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  const versions = fs.readdirSync(kits).filter(v => /^10\./.test(v)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).reverse();
  for (const v of versions) {
    const tool = path.join(kits, v, 'x64', 'makeappx.exe');
    if (fs.existsSync(tool)) return tool;
  }
  throw new Error('makeappx.exe not found in the Windows SDK');
}

function packageMsix(appDir, outDir, release, env = process.env) {
  const identityName = env.MSIX_IDENTITY_NAME;
  const publisher = env.MSIX_PUBLISHER;
  const publisherDisplayName = env.MSIX_PUBLISHER_DISPLAY_NAME;
  if (!identityName || !publisher || !publisherDisplayName) throw new Error('MSIX_IDENTITY_NAME, MSIX_PUBLISHER and MSIX_PUBLISHER_DISPLAY_NAME are required');
  const product = JSON.parse(fs.readFileSync(path.join(appDir, 'resources', 'app', 'product.json'), 'utf8'));
  if (!fs.existsSync(path.join(appDir, `${product.nameShort}.exe`))) throw new Error(`${product.nameShort}.exe not found in ${appDir}`);
  const scratch = fs.mkdtempSync(path.join(outDir, '.msix-'));
  try {
    const manifestPath = path.join(scratch, 'AppxManifest.xml');
    fs.writeFileSync(manifestPath, manifest({ identityName, publisher, publisherDisplayName, version: msixVersion(release), product }));
    const assetDir = path.join(__dirname, '..', 'branding', 'msix');
    const mapping = [
      ...filesUnder(appDir),
      [manifestPath, 'AppxManifest.xml'],
      ...assets.map(a => [path.join(assetDir, a), path.join('Assets', a)]),
    ];
    if (mapping.some(([source, target]) => /"/.test(source + target))) throw new Error('File names with quotes cannot be packaged');
    const mappingPath = path.join(scratch, 'mapping.txt');
    fs.writeFileSync(mappingPath, `[Files]\r\n${mapping.map(([s, t]) => `"${s}" "${t}"`).join('\r\n')}\r\n`);
    const out = path.join(outDir, `AraraCode-x64-${release}.msix`);
    execFileSync(makeappx(), ['pack', '/f', mappingPath, '/p', out, '/o'], { stdio: 'inherit' });
    return out;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const [appDir, outDir, release] = process.argv.slice(2);
  if (!appDir || !outDir || !release) {
    console.error('usage: package-msix.cjs <app-dir> <out-dir> <release-version>');
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  console.log(packageMsix(path.resolve(appDir), path.resolve(outDir), release));
}

module.exports = { msixVersion, manifest, packageMsix };
