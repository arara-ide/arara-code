const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

const source = process.env.ARARA_UPSTREAM_SOURCE || path.resolve(__dirname, '../../.work/vscodium/vscode');
const linuxBuild = path.join(source, 'build/linux');

test('Debian reference dependencies resolve before scanning binaries or fetching tools', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-debian-deps-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { getDependencies } = await import(pathToFileURL(path.join(linuxBuild, 'dependencies-generator.ts')).href);
  const { referenceGeneratedDepsByArch } = await import(pathToFileURL(path.join(linuxBuild, 'debian/dep-lists.ts')).href);

  process.env.ARARA_USE_REFERENCE_DEBIAN_DEPS = '1';
  for (const [arch, dependencies] of Object.entries(referenceGeneratedDepsByArch)) {
    assert.deepEqual(await getDependencies('deb', dir, 'arara-code', arch), dependencies);
  }
  await assert.rejects(getDependencies('deb', dir, 'arara-code', 'x64'), /Invalid Debian arch/);
  assert.deepEqual(await getDependencies('rpm', dir, 'arara-code', 'x86_64'), []);

  delete process.env.ARARA_USE_REFERENCE_DEBIAN_DEPS;
  assert.deepEqual(await getDependencies('deb', dir, 'arara-code', 'amd64'), []);
});
