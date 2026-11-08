const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

assert.equal(process.platform, 'darwin');
const identity = process.env.ARARA_MACOS_SIGN_IDENTITY;
assert.match(identity || '', /^[a-f\d]{40}$/i);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-signing-live-'));
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const requirements = [];
  for (const version of ['1', '2']) {
    const app = path.join(work, `version-${version}`, 'Fixture.app');
    fs.mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
    fs.writeFileSync(path.join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.arara.signing.fixture</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleVersion</key><string>${version}</string></dict></plist>`);
    fs.copyFileSync(version === '1' ? '/usr/bin/true' : '/usr/bin/false', path.join(app, 'Contents/MacOS/fixture'));
    run('bash', [path.join(__dirname, '../sign-macos.sh'), app]);
    const result = require('node:child_process').spawnSync('codesign', ['-dr', '-', app], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    requirements.push((result.stdout + result.stderr).match(/designated => (.+)/)[1]);
  }
  assert.equal(requirements[0], requirements[1]);
  assert.ok(requirements[0].toLowerCase().includes(identity.toLowerCase()));
  console.log('PASS: two signed app versions share a certificate-bound designated requirement');
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
