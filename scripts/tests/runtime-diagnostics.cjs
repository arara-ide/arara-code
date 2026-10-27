const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '../..');
const upstream = path.join(root, '.work/vscodium/vscode');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-diagnostics-'));
const uri = fsPath => ({ fsPath });
const joinPath = (base, ...segments) => uri(path.join(base.fsPath, ...segments));
const fileService = {
  exists: async target => fsp.access(target.fsPath).then(() => true, () => false),
  createFolder: target => fsp.mkdir(target.fsPath, { recursive: true }),
  copy: (from, to) => fsp.cp(from.fsPath, to.fsPath, { recursive: true, force: false, errorOnExist: true }),
  move: (from, to) => fsp.rename(from.fsPath, to.fsPath),
  del: target => fsp.rm(target.fsPath, { recursive: true }),
};
function applyPatch(name) {
  const patch = path.join(root, 'patches/code', name);
  const text = fs.readFileSync(patch, 'utf8');
  for (const match of text.matchAll(/^--- a\/(.+)$/gm)) {
    const target = path.join(dir, match[1]);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const fd = fs.openSync(target, 'w');
    try { execFileSync('git', ['show', `HEAD:${match[1]}`], { cwd: upstream, stdio: ['ignore', fd, 'inherit'] }); }
    finally { fs.closeSync(fd); }
  }
  execFileSync('git', ['apply', '--check', patch], { cwd: dir, stdio: 'inherit' });
  execFileSync('git', ['apply', patch], { cwd: dir, stdio: 'inherit' });
}
(async () => {
  for (const patch of ['0036-writable-builtin-extensions.patch', '0037-webview-supported-permissions.patch', '0038-builtin-extension-dedup-log.patch']) applyPatch(patch);
  const helper = fs.readFileSync(path.join(dir, 'src/vs/platform/extensionManagement/common/writableBuiltinExtensions.ts'), 'utf8');
  const prepare = vm.runInNewContext(stripTypeScriptTypes(helper).replace(/^import .*;\n/gm, '').replace('export async function', 'async function') + '; prepareWritableBuiltinExtension', { joinPath, generateUuid: crypto.randomUUID });
  const original = uri(path.join(dir, 'readonly-extension'));
  const storage = uri(path.join(dir, 'user-storage'));
  await fsp.mkdir(path.join(original.fsPath, 'icons'), { recursive: true });
  await fsp.writeFile(path.join(original.fsPath, 'package.json'), JSON.stringify({ publisher: 'test', name: 'icons', version: '1.0.0' }));
  await fsp.writeFile(path.join(original.fsPath, 'theme.json'), '{"default":true}');
  await fsp.writeFile(path.join(original.fsPath, 'icons', 'file.svg'), '<svg/>');
  const extension = { identifier: { id: 'test.icons' }, manifest: { version: '1.0.0' }, location: original, type: 0, isBuiltin: true, isValid: true, metadata: { installedTimestamp: 123 } };
  const errors = [];
  const log = { error: (...args) => errors.push(args) };
  const first = await prepare(extension, storage, 'build-1', fileService, log);
  assert.notEqual(first.location.fsPath, original.fsPath);
  for (const key of ['identifier', 'manifest', 'type', 'isBuiltin', 'isValid', 'metadata']) assert.equal(first[key], extension[key]);
  assert.equal(await fsp.readFile(path.join(first.location.fsPath, 'icons/file.svg'), 'utf8'), '<svg/>');
  await fsp.writeFile(path.join(first.location.fsPath, 'theme.json'), '{"customized":true}');
  const again = await prepare(extension, storage, 'build-1', fileService, log);
  assert.equal(again.location.fsPath, first.location.fsPath);
  assert.equal(await fsp.readFile(path.join(again.location.fsPath, 'theme.json'), 'utf8'), '{"customized":true}');
  assert.equal(await fsp.readFile(path.join(original.fsPath, 'theme.json'), 'utf8'), '{"default":true}');
  const upgraded = await prepare(extension, storage, 'build-2', fileService, log);
  assert.notEqual(upgraded.location.fsPath, first.location.fsPath);
  assert.equal(await fsp.readFile(path.join(upgraded.location.fsPath, 'theme.json'), 'utf8'), '{"default":true}');
  const concurrent = await Promise.all([prepare(extension, storage, 'build-race', fileService, log), prepare(extension, storage, 'build-race', fileService, log)]);
  assert.equal(concurrent[0].location.fsPath, concurrent[1].location.fsPath);
  assert.equal(await fileService.exists(joinPath(concurrent[0].location, 'package.json')), true);
  const traversal = await prepare({ ...extension, identifier: { id: '../outside' } }, storage, '../../outside', fileService, log);
  assert.ok(!path.relative(storage.fsPath, traversal.location.fsPath).startsWith('..'));
  const broken = { ...fileService, copy: async (from, to) => { await fsp.mkdir(to.fsPath); throw new Error('copy failed'); } };
  assert.equal(await prepare(extension, storage, 'broken', broken, log), extension);
  assert.equal(errors.length, 1);
  const entries = await fsp.readdir(path.join(storage.fsPath, 'builtin-extensions/test.icons'));
  assert.ok(entries.every(name => !name.startsWith('.staging-')));
  for (const relative of ['src/vs/workbench/contrib/webview/browser/webviewElement.ts', 'src/vs/workbench/contrib/webview/browser/pre/index.html']) {
    const source = fs.readFileSync(path.join(dir, relative), 'utf8');
    const match = source.match(/const allowRules = \[[^\n]+\];\s+if \([^\n]+local-network-access[^\n]+\) \{\s+allowRules.push\([^\n]+\);\s+\}/);
    assert.ok(match, relative);
    const run = stripTypeScriptTypes(match[0]);
    for (const features of [undefined, [], ['local-network-access']]) {
      const featurePolicy = features && { features: () => features };
      const rules = vm.runInNewContext(run + '; allowRules', { document: { featurePolicy } });
      assert.equal(rules.some(rule => rule.startsWith('local-network-access')), !!features?.includes('local-network-access'));
      assert.ok(rules.some(rule => rule.startsWith('autoplay')) && rules.some(rule => rule.startsWith('cross-origin-isolated')));
    }
  }
  const relative = 'src/vs/workbench/services/extensions/common/extensionsUtil.ts';
  const source = fs.readFileSync(path.join(dir, relative), 'utf8');
  const logs = [];
  class ExtensionIdentifierMap extends Map {
    get(id) { return super.get(typeof id === 'string' ? id : id.value); }
    set(id, value) { return super.set(typeof id === 'string' ? id : id.value, value); }
  }
  const semver = require(path.join(upstream, 'node_modules/semver'));
  const dedup = vm.runInNewContext(stripTypeScriptTypes(source, { mode: 'transform' }).replace(/^import .*;\n/gm, '').replace('export function', 'function') + '; dedupExtensions', { ExtensionIdentifierMap, semver, localize: (_, value) => value });
  const logger = { debug: value => logs.push(['debug', value]), warn: value => logs.push(['warn', value]), info: value => logs.push(['info', value]) };
  const builtin = { identifier: { value: 'test.extension' }, version: '2.0.0', isBuiltin: true, extensionLocation: { path: '/builtin', fsPath: '/builtin' } };
  for (const version of ['1.0.0', '2.0.0', '3.0.0']) {
    const user = { ...builtin, version, isBuiltin: false, extensionLocation: { path: '/user', fsPath: '/user' } };
    const result = dedup([builtin], [user], [], [], logger);
    assert.equal(result[0], version === '3.0.0' ? user : builtin);
    assert.equal(result[0].isBuiltin, true);
  }
  assert.ok(logs.every(([level]) => level === 'debug'));
  console.log('PASS: actual patches apply; writable themes preserve resources, metadata, customization and original files; upgrades, concurrent startup and failure cleanup; feature policies; builtin/user version selection unchanged.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
