const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.join(__dirname, '..', '..');
const version = '1.135.07120';
const workflow = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');
const macos = fs.readFileSync(path.join(root, '.github/workflows/build-macos.yml'), 'utf8');
const job = name => workflow.split(`\n  ${name}:\n`)[1].split(/\n  [\w-]+:\n/)[0];

function tools(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arara dmg '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin'), log = path.join(directory, 'calls.log');
  fs.mkdirSync(bin);
  const fake = `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
const name = path.basename(process.argv[1]); const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify([name, ...args]) + '\\n');
if (name === 'ditto' && args[0] === '-x') fs.mkdirSync(path.join(args.at(-1), 'Arara Code.app'), { recursive: true });
if (name === 'ditto' && args[0] !== '-x') fs.mkdirSync(args.at(-1), { recursive: true });
if (name === 'PlistBuddy') process.stdout.write('Arara Code\\n');
if (name === 'lipo' && process.env.WRONG_ARCH) process.exit(1);
if (name === 'hdiutil' && args[0] === 'create') fs.writeFileSync(args.at(-1), 'dmg');
`;
  for (const name of ['ditto', 'lipo', 'codesign', 'hdiutil', 'PlistBuddy']) { fs.writeFileSync(path.join(bin, name), fake); fs.chmodSync(path.join(bin, name), 0o755); }
  const script = fs.readFileSync(path.join(root, 'scripts/package-macos-dmg.sh'), 'utf8').replace('/usr/libexec/PlistBuddy', 'PlistBuddy');
  fs.writeFileSync(path.join(directory, 'package.sh'), script);
  const input = path.join(directory, 'in'), output = path.join(directory, 'out');
  fs.mkdirSync(input);
  const run = (arch, extra = {}) => spawnSync('bash', [path.join(directory, 'package.sh'), input, output, version, arch], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: log, ...extra } });
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  return { run, calls, output };
}

test('packages one DMG per processor and verifies the binary matches it', t => {
  for (const [arch, cpu] of [['x64', 'x86_64'], ['arm64', 'arm64']]) {
    const f = tools(t);
    assert.equal(f.run(arch).status, 0);
    assert.deepEqual(fs.readdirSync(f.output), [`AraraCode-darwin-${arch}-${version}.dmg`]);
    assert.ok(f.calls().some(([name, , flag, value]) => name === 'lipo' && flag === '-verify_arch' && value === cpu));
    assert.ok(f.calls().some(([name, file]) => name === 'ditto' && file === '-x'));
  }
});

test('refuses an unknown processor, an invalid version and a binary of the wrong architecture', t => {
  const f = tools(t);
  assert.notEqual(f.run('universal').status, 0);
  assert.notEqual(f.run('x64', { WRONG_ARCH: '1' }).status, 0);
  assert.equal(fs.existsSync(f.output) ? fs.readdirSync(f.output).length : 0, 0);
});

test('the workflow builds, tests and publishes Intel and Apple Silicon separately, without a merge step', () => {
  assert.doesNotMatch(workflow + macos, /universal|macos_source_run|merge-tools/);
  assert.match(job('macos-x64'), /runner: macos-15-intel/);
  assert.match(job('macos-arm64'), /runner: macos-15\n/);
  assert.match(job('release-macos-x64'), /needs: \[version, macos-x64\]/);
  assert.match(job('release-macos-arm64'), /needs: \[version, macos-arm64\]/);
  assert.match(macos, /package-macos-dmg\.sh dist release "\$RELEASE_VERSION" "\$ARCH"/);
  assert.match(macos, /test-macos-dmg\.sh "release\/AraraCode-darwin-\$\{ARCH\}-\$\{RELEASE_VERSION\}\.dmg"/);
  assert.match(macos, /arara-code-development-macos-\{0\}/);
  assert.match(job('release-macos-x64'), /github\.ref == 'refs\/heads\/main'/);
});
