const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { recover, recoveryRelease } = require('../macos-recovery.cjs');

const sha = 'a'.repeat(40);
const repository = 'arara-ide/arara-code';
const fixture = () => ({
  repository,
  run: { head_branch: 'main', head_repository: { full_name: repository }, head_sha: sha, path: '.github/workflows/build.yml', status: 'completed', event: 'push' },
  jobs: ['x64', 'arm64'].map(arch => ({ name: `macos-${arch} / build`, conclusion: 'success' })),
  releases: [{ target_commitish: sha, tag_name: '1.135.07366', draft: false, prerelease: true, assets: [] }],
  comparison: { status: 'ahead' },
});

test('recovers the original version, commit and release channel without compiling', () => {
  const f = fixture();
  assert.deepEqual(recoveryRelease(f), { release: '1.135.07366', sha, prerelease: 'true' });
  f.releases[0].prerelease = false;
  assert.equal(recoveryRelease(f).prerelease, 'false');
});

test('rejects untrusted runs, incomplete architectures and incompatible releases', () => {
  const changes = [
    f => { f.run.head_branch = 'development'; },
    f => { f.run.head_repository.full_name = 'other/fork'; },
    f => { f.run.path = '.github/workflows/other.yml'; },
    f => { f.run.status = 'in_progress'; },
    f => { f.run.event = 'pull_request'; },
    f => { f.run.head_sha = 'invalid'; },
    f => { f.comparison.status = 'diverged'; },
    f => { f.jobs[0].conclusion = 'failure'; },
    f => { f.jobs.pop(); },
    f => { f.releases = []; },
    f => { f.releases.push({ ...f.releases[0] }); },
    f => { f.releases[0].target_commitish = 'b'.repeat(40); },
    f => { f.releases[0].draft = true; },
    f => { f.releases[0].immutable = true; },
    f => { f.releases[0].tag_name = '../unsafe'; },
    f => { f.releases[0].assets.push({ name: 'AraraCode-darwin-universal-1.135.07366.dmg' }); },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    assert.throws(() => recoveryRelease(f));
  }
});

test('reads source metadata through authenticated API calls and validates before emitting outputs', () => {
  const f = fixture();
  const env = { GITHUB_REF: 'refs/heads/main', MACOS_SOURCE_RUN: '41537990161', GITHUB_REPOSITORY: repository, GITHUB_SHA: 'b'.repeat(40) };
  const calls = [];
  const gh = args => {
    calls.push(args);
    const endpoint = args[1];
    if (endpoint.includes('/jobs?')) return JSON.stringify({ jobs: f.jobs });
    if (endpoint.includes('/releases?')) return JSON.stringify(f.releases);
    if (endpoint.includes('/compare/')) return JSON.stringify(f.comparison);
    return JSON.stringify(f.run);
  };
  assert.equal(recover({ env, gh }).sha, sha);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(([command, endpoint]) => command === 'api' && endpoint.startsWith(`repos/${repository}/`)));
  for (const invalid of [{ GITHUB_REF: 'refs/heads/development' }, { MACOS_SOURCE_RUN: '../unsafe' }, { GITHUB_SHA: '' }]) assert.throws(() => recover({ env: { ...env, ...invalid }, gh: () => assert.fail('API must not be called') }));
});

test('recovery skips compilation, uses the original artifacts and publishes only after both native tests', () => {
  const root = path.resolve(__dirname, '../..');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');
  const job = name => workflow.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [a-z][\\w-]*:|$(?![\\s\\S]))`, 'm'))?.[0];
  for (const name of ['linux', 'windows', 'macos-x64', 'macos-arm64']) assert.match(job(name), /!inputs.macos_source_run/);
  assert.match(job('version'), /scripts\/macos-recovery.cjs/);
  assert.match(job('macos-universal'), /always\(\)/);
  assert.match(job('macos-universal'), /needs.version.result == 'success'/);
  assert.match(job('macos-universal'), /run-id: \$\{\{ inputs.macos_source_run \|\| github.run_id \}\}/);
  assert.match(job('test-macos-universal'), /runner: \[macos-15-intel, macos-15\]/);
  assert.match(job('release-macos-universal'), /needs: \[version, test-macos-universal\]/);
  assert.match(job('release-macos-universal'), /source-sha: \$\{\{ needs.version.outputs.source_sha \}\}/);
  const publish = fs.readFileSync(path.join(root, '.github/workflows/publish-release.yml'), 'utf8');
  assert.match(publish, /RELEASE_SOURCE_SHA: \$\{\{ inputs.source-sha \}\}/);
});
