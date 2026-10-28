const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { publish, releaseNotes } = require('../publish-release.cjs');

const version = '1.135.07120';
const sha = 'a'.repeat(40);
const hash = data => createHash('sha256').update(data).digest('hex');
const names = [
  `AraraCodeSetup-x64-${version}.exe`,
  `arara-code_${version}_amd64.deb`,
  `AraraCode-darwin-arm64-${version}.zip`,
  `AraraCode-darwin-x64-${version}.zip`,
  `AraraCode-linux-x64-${version}.AppImage`,
  `AraraCode-win32-x64-${version}.zip`,
];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-publish-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist);
  const changelog = path.join(root, 'CHANGELOG.md');
  fs.writeFileSync(changelog, '# Changelog\n\n## [Não lançado]\n\n### Correções\n- Editor: correção nova.\n\n## [1.0.00000]\n- Mudança antiga.\n');
  const state = { release: undefined, releases: [], assets: [], creates: 0, uploads: [], failUpload: undefined, omitDigest: false, apiError: false, listError: false, hiddenListings: 0, sleeps: 0 };
  const env = { RELEASE_VERSION: version, GITHUB_REPOSITORY: 'arara-ide/arara-code', GITHUB_SHA: sha, GITHUB_REF: 'refs/heads/main', PRERELEASE: 'true' };
  const gh = args => {
    const option = flag => args[args.indexOf(flag) + 1];
    if (args[0] === 'api') {
      if (state.apiError) throw Object.assign(new Error('Access denied'), { stderr: 'gh: forbidden (HTTP 403)' });
      if (args.at(-1).includes('/tags/')) {
        if (!state.release || state.release.draft) throw Object.assign(new Error('Not found'), { stderr: 'gh: Not Found (HTTP 404)' });
        return JSON.stringify(state.release);
      }
      if (args.includes('--method')) {
        const id = Number(args.at(-1).split('/').at(-1));
        state.assets = state.assets.filter(a => a.id !== id);
        return '';
      }
      const url = new URL(`https://api.github.com/${args.at(-1)}`);
      const page = Number(url.searchParams.get('page'));
      if (url.pathname.endsWith('/releases')) {
        if (state.listError) throw Object.assign(new Error('Release listing denied'), { stderr: 'gh: forbidden (HTTP 403)' });
        const hidden = state.hiddenListings > 0 && page === 1 ? state.hiddenListings-- > 0 : false;
        return JSON.stringify([...state.releases, ...(state.release && !hidden ? [state.release] : [])].slice((page - 1) * 100, page * 100));
      }
      return JSON.stringify(state.assets.slice((page - 1) * 100, page * 100).map(({ bytes, ...asset }) => ({ ...asset, digest: state.omitDigest ? null : `sha256:${hash(bytes)}` })));
    }
    if (args[1] === 'create') {
      assert.equal(state.release, undefined, 'only one release is created');
      assert.ok(args.includes('--draft'), 'first upload must remain private until checksums exist');
      state.creates++;
      state.release = { id: 42, tag_name: args[2], target_commitish: option('--target'), draft: true, prerelease: args.includes('--prerelease'), immutable: false };
      if (state.hideAfterCreate) state.hiddenListings = state.hideAfterCreate;
    } else if (args[1] === 'upload') {
      const file = args[3];
      const name = path.basename(file);
      if (state.failUpload === name) throw new Error('Upload interrupted');
      const existing = state.assets.findIndex(a => a.name === name);
      if (existing !== -1) {
        assert.ok(args.includes('--clobber'), 'packages cannot be silently replaced');
        state.assets.splice(existing, 1);
      }
      state.uploads.push(name);
      state.assets.push({ id: state.uploads.length, name, state: 'uploaded', bytes: fs.readFileSync(file) });
    } else if (args[1] === 'download') {
      const asset = state.assets.find(a => a.name === option('--pattern'));
      fs.writeFileSync(path.join(option('--dir'), asset.name), asset.bytes);
    } else if (args[1] === 'edit') {
      assert.ok(state.assets.some(a => a.name === 'SHA256SUMS'), 'checksums exist before publication');
      state.notes = fs.readFileSync(option('--notes-file'), 'utf8');
      if (args.includes('--draft=false')) state.release.draft = false;
    } else throw new Error(`Unexpected gh call: ${args.join(' ')}`);
    return '';
  };
  return { state, env, dist, async run(name = names[0]) {
    fs.rmSync(dist, { recursive: true });
    fs.mkdirSync(dist);
    if (name) fs.writeFileSync(path.join(dist, name), `package ${name}`);
    return publish({ env, dist, changelog, gh, sleep: async () => { state.sleeps++; } });
  } };
}

test('a just-created draft that the listing does not return yet is awaited instead of crashing', async t => {
  const f = fixture(t);
  f.state.hideAfterCreate = 4;
  await f.run(names[1]);
  assert.equal(f.state.creates, 1);
  assert.equal(f.state.release.draft, false);
  assert.ok(f.state.sleeps >= 4, 'waited for the draft to be listed');
  assert.ok(f.state.assets.some(a => a.name === names[1]));
});

test('a draft from the previous platform that is still unlisted is not duplicated', async t => {
  const f = fixture(t);
  f.state.failUpload = 'SHA256SUMS';
  await assert.rejects(f.run(), /Upload interrupted/);
  f.state.failUpload = undefined;
  f.state.hiddenListings = 2;
  await f.run(names[1]);
  assert.equal(f.state.creates, 1);
  assert.equal(f.state.release.draft, false);
});

test('a draft that never becomes visible stops with an actionable error', async t => {
  const f = fixture(t);
  f.state.hideAfterCreate = 1000;
  await assert.rejects(f.run(), /created but is not listed yet; rerun/);
  assert.equal(f.state.creates, 1);
  assert.equal(f.state.uploads.length, 0);
});

test('Windows can publish first; Linux and both Macs append to the same release, with cumulative checksums', async t => {
  const f = fixture(t);
  for (let i = 0; i < names.length; i++) {
    await f.run(names[i]);
    assert.equal(f.state.creates, 1);
    assert.equal(f.state.release.draft, false);
    const sums = f.state.assets.find(a => a.name === 'SHA256SUMS').bytes.toString();
    for (const name of names.slice(0, i + 1)) assert.ok(sums.includes(`${hash(`package ${name}`)}  ${name}\n`));
    assert.equal(sums.trim().split('\n').length, i + 1);
    assert.ok(!sums.includes('SHA256SUMS'), 'manifest never hashes itself');
  }
  assert.match(f.state.notes, /Editor: correção nova/);
  assert.doesNotMatch(f.state.notes, /Mudança antiga/);
  assert.match(f.state.notes, /Apple Silicon/);
  assert.match(f.state.notes, /Intel/);
  await f.run(names[0]);
  assert.equal(f.state.uploads.filter(n => n === names[0]).length, 1, 'rerunning identical bytes does not replace a package');
});

test('interrupted first upload is resumed and remains draft until checksum publication succeeds', async t => {
  const f = fixture(t);
  f.state.failUpload = 'SHA256SUMS';
  await assert.rejects(f.run(), /Upload interrupted/);
  assert.equal(f.state.release.draft, true);
  f.state.failUpload = undefined;
  await f.run(names[1]);
  assert.equal(f.state.creates, 1);
  assert.equal(f.state.release.draft, false);
  assert.match(f.state.assets.find(a => a.name === 'SHA256SUMS').bytes.toString(), /AraraCodeSetup/);
});

test('each platform can independently be the first successful build', async t => {
  for (const name of names) {
    const f = fixture(t);
    await f.run(name);
    assert.equal(f.state.creates, 1);
    assert.equal(f.state.release.draft, false);
    assert.equal(f.state.assets.find(a => a.name === 'SHA256SUMS').bytes.toString(), `${hash(`package ${name}`)}  ${name}\n`);
    if (!name.endsWith('.deb')) assert.doesNotMatch(f.state.notes, /sudo apt install/);
    if (!name.includes('-darwin-')) assert.doesNotMatch(f.state.notes, /xattr -cr/);
  }
});

test('a draft on a later release page is resumed without creating another release', async t => {
  const f = fixture(t);
  f.state.failUpload = 'SHA256SUMS';
  await assert.rejects(f.run(), /Upload interrupted/);
  for (let i = 0; i < 100; i++) f.state.releases.push({ id: 1000 + i, tag_name: `other-${i}`, draft: true });
  f.state.failUpload = undefined;
  await f.run(names[1]);
  assert.equal(f.state.creates, 1);
  assert.equal(f.state.release.draft, false);
  assert.ok(f.state.assets.some(asset => asset.name === names[0]));
});

test('duplicate releases on different pages stop publication without changing assets', async t => {
  for (const draft of [true, false]) {
    const f = fixture(t);
    f.state.failUpload = 'SHA256SUMS';
    await assert.rejects(f.run(), /Upload interrupted/);
    f.state.releases.push({ ...f.state.release, id: 43 });
    f.state.release.draft = draft;
    for (let i = 0; i < 99; i++) f.state.releases.push({ id: 1000 + i, tag_name: `other-${i}`, draft: true });
    const uploads = [...f.state.uploads];
    f.state.failUpload = undefined;
    await assert.rejects(f.run(names[1]), /Multiple releases found/);
    assert.equal(f.state.creates, 1);
    assert.equal(f.state.release.draft, draft);
    assert.deepEqual(f.state.uploads, uploads);
  }
});

test('release listing failures are propagated without creating a release', async t => {
  const f = fixture(t);
  f.state.listError = true;
  await assert.rejects(f.run(), /Release listing denied/);
  assert.equal(f.state.creates, 0);
  assert.equal(f.state.uploads.length, 0);
});

test('a later platform repairs a failed checksum update without losing published packages', async t => {
  const f = fixture(t);
  await f.run();
  f.state.failUpload = 'SHA256SUMS';
  await assert.rejects(f.run(names[1]), /Upload interrupted/);
  assert.equal(f.state.release.draft, false);
  f.state.failUpload = undefined;
  await f.run(names[2]);
  const sums = f.state.assets.find(a => a.name === 'SHA256SUMS').bytes.toString();
  for (const name of names.slice(0, 3)) assert.ok(sums.includes(name));
  assert.equal(f.state.creates, 1);
});

test('older assets without API digests are downloaded and hashed', async t => {
  const f = fixture(t);
  await f.run();
  f.state.omitDigest = true;
  await f.run(names[1]);
  assert.equal(f.state.assets.find(a => a.name === 'SHA256SUMS').bytes.toString().trim().split('\n').length, 2);
});

test('checksums include every page of release assets', async t => {
  const f = fixture(t);
  await f.run();
  for (let i = 0; i < 101; i++) f.state.assets.push({ id: 1000 + i, name: `archive-${i}-${version}.zip`, state: 'uploaded', bytes: Buffer.from(`archive ${i}`) });
  await f.run(names[1]);
  const sums = f.state.assets.find(a => a.name === 'SHA256SUMS').bytes.toString();
  assert.equal(sums.trim().split('\n').length, 103);
  assert.ok(sums.includes(`archive-100-${version}.zip`));
});

test('development, denied API calls and empty packages never create a release', async t => {
  const f = fixture(t);
  f.env.GITHUB_REF = 'refs/heads/development';
  await assert.rejects(f.run(), /only from main/);
  f.env.GITHUB_REF = 'refs/heads/main';
  f.state.apiError = true;
  await assert.rejects(f.run(), /Access denied/);
  f.state.apiError = false;
  await assert.rejects(f.run(null), /Expected only packages/);
  assert.equal(f.state.creates, 0);
});

test('existing release commit, immutable flag, prerelease flag and differing bytes are protected', async t => {
  const f = fixture(t);
  await f.run();
  f.state.release.target_commitish = 'b'.repeat(40);
  await assert.rejects(f.run(names[1]), /different commit/);
  f.state.release.target_commitish = sha;
  f.state.release.immutable = true;
  await assert.rejects(f.run(names[1]), /immutability/);
  f.state.release.immutable = false;
  f.env.PRERELEASE = 'false';
  await assert.rejects(f.run(names[1]), /prerelease setting/);
  f.env.PRERELEASE = 'true';
  f.state.assets.find(a => a.name === names[0]).bytes = Buffer.from('different binary');
  await assert.rejects(f.run(), /Refusing to replace/);
});

test('stable release respects the input and starter assets can be recovered', async t => {
  const f = fixture(t);
  f.env.PRERELEASE = 'false';
  await f.run();
  assert.equal(f.state.release.prerelease, false);
  assert.doesNotMatch(f.state.notes, /Versão de teste/);
  f.state.assets.push({ id: 999, name: names[1], state: 'starter', bytes: Buffer.alloc(0) });
  await f.run(names[1]);
  assert.ok(!f.state.assets.some(a => a.state === 'starter'));
});

test('rejects UserSetup packages before creating or changing a release', async t => {
  const f = fixture(t);
  await assert.rejects(f.run(`AraraCodeUserSetup-x64-${version}.exe`), /Expected only packages/);
  assert.equal(f.state.creates, 0);
  assert.equal(f.state.uploads.length, 0);
});

test('release instructions offer AppImage as a choice and explain UserSetup migration', () => {
  const notes = releaseNotes(version, names, '', false);
  assert.match(notes, /chmod \+x AraraCode-linux-x64-/);
  assert.match(notes, /substitua o AppImage anterior/);
  assert.match(notes, /desinstale a instalação antiga/);
  assert.doesNotMatch(notes, /AraraCodeUserSetup-.*\.exe/);
});

test('resuming a release preserves checksums for previously published legacy packages', async t => {
  const f = fixture(t);
  await f.run();
  const legacy = { id: 999, name: `AraraCodeUserSetup-x64-${version}.exe`, state: 'uploaded', bytes: Buffer.from('legacy') };
  f.state.assets.push(legacy);
  await f.run(names[1]);
  const sums = f.state.assets.find(a => a.name === 'SHA256SUMS').bytes.toString();
  assert.ok(sums.includes(`${hash(legacy.bytes)}  ${legacy.name}\n`));
  assert.ok(f.state.assets.includes(legacy));
});
