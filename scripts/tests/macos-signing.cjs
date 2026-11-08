const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const root = path.join(__dirname, '../..');

test('signing refuses missing and ad hoc identities before invoking codesign', () => {
  for (const identity of ['', '-', 'name']) {
    const result = spawnSync('bash', [path.join(root, 'scripts/sign-macos.sh'), '/missing.app'], { env: { ...process.env, ARARA_MACOS_SIGN_IDENTITY: identity, ARARA_MACOS_SIGN_KEYCHAIN: '/missing' } });
    assert.notEqual(result.status, 0);
  }
});

test('signs and verifies the certificate binding with paths containing spaces', t => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'arara signing '));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const app = path.join(work, 'Fixture App.app');
  const keychain = path.join(work, 'signing.keychain-db');
  const log = path.join(work, 'calls');
  fs.mkdirSync(app);
  fs.writeFileSync(keychain, '');
  fs.writeFileSync(path.join(work, 'codesign'), `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.CALLS, JSON.stringify(process.argv.slice(2))+'\\n');\nif(process.env.FAIL_SIGN)process.exit(1);\n`, { mode: 0o755 });
  const identity = 'a'.repeat(40);
  const env = { ...process.env, PATH: `${work}:${process.env.PATH}`, CALLS: log, ARARA_MACOS_SIGN_IDENTITY: identity, ARARA_MACOS_SIGN_KEYCHAIN: keychain };
  const result = spawnSync('bash', [path.join(root, 'scripts/sign-macos.sh'), app], { env });
  assert.equal(result.status, 0, result.stderr.toString());
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 3);
  assert.ok(calls[0].includes(identity));
  assert.ok(calls[0].includes(keychain));
  assert.equal(calls[0].at(-1), app);
  assert.ok(calls[2].includes(`=certificate leaf = H"${identity}"`));
  assert.notEqual(spawnSync('bash', [path.join(root, 'scripts/sign-macos.sh'), app], { env: { ...env, FAIL_SIGN: '1' } }).status, 0);
});

test('build imports the persistent secret, checks continuity and cleans the keychain', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/build-macos.yml'), 'utf8');
  const build = fs.readFileSync(path.join(root, 'scripts/build.sh'), 'utf8');
  assert.match(workflow, /secrets.ARARA_MACOS_SIGN_P12_BASE64/);
  assert.match(workflow, /secrets.ARARA_MACOS_SIGN_PASSWORD/);
  assert.match(workflow, /macos-signing-live.cjs/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /security delete-keychain/);
  assert.match(build, /scripts\/sign-macos.sh/);
  assert.doesNotMatch(build, /codesign .*--sign - /);
});
