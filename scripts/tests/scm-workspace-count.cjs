// Exercise the patched SCM count with the upstream observable implementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const upstream = path.join(root, '.work/vscodium/vscode');
const relative = 'src/vs/workbench/contrib/scm/browser/activity.ts';
const patch = path.join(root, 'patches/code/0029-scm-workspace-count.patch');
const ts = require(path.join(upstream, 'node_modules/typescript'));
const esbuild = require(path.join(upstream, 'build/node_modules/esbuild'));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-scm-count-'));
  try {
    const original = execFileSync('git', ['show', `HEAD:${relative}`], { cwd: upstream });
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, original);
    execFileSync('git', ['apply', '--check', patch], { cwd: dir });
    execFileSync('git', ['apply', patch], { cwd: dir });
    const source = fs.readFileSync(file, 'utf8');
    const code = source.slice(source.indexOf('\t\tthis._countBadgeConfig ='), source.indexOf('\n\t\tthis._register(autorun'));
    assert.ok(code.includes('this._countBadge = derived'));
    const observableBundle = path.join(dir, 'observables.cjs');
    esbuild.buildSync({
      stdin: { contents: "export * from './observable.js'; export { Emitter, Event } from './event.js';", resolveDir: path.join(upstream, 'src/vs/base/common'), loader: 'ts' },
      bundle: true, platform: 'node', format: 'cjs', outfile: observableBundle,
    });
    const { observableValue, observableFromEvent, derived, autorun, Emitter, Event } = require(observableBundle);
    const mode = observableValue('mode', 'all');
    const added = new Emitter(), removed = new Emitter(), visibleChanged = new Emitter();
    const repo = (name, count, resources) => ({ provider: {
      name, count: observableValue(`${name}.count`, count),
      resources: observableValue(`${name}.resources`, resources),
    } });
    const a = repo('a', 3, 99), b = repo('b', 7, 99), c = repo('c', undefined, 4);
    const repositories = new Map([['a', a], ['b', b]]);
    const active = observableValue('active', { repository: a });
    const controller = {
      scmService: { get repositories() { return repositories.values(); }, onDidAddRepository: added.event, onDidRemoveRepository: removed.event },
      scmViewService: { visibleRepositories: [a], onDidChangeVisibleRepositories: visibleChanged.event, activeRepository: active },
      _getRepositoryResourceCount: r => r.provider.resources,
    };
    const output = ts.transpileModule(`(function () { ${code}\n }).call(controller);`, { compilerOptions: { target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
    assert.deepEqual(output.diagnostics, []);
    vm.runInNewContext(output.outputText, { controller, observableFromEvent, derived, Event, observableConfigValue: () => mode });
    let count;
    const subscription = autorun(reader => { count = controller._countBadge.read(reader); });
    assert.equal(count, 10, 'include the unselected repository');
    controller.scmViewService.visibleRepositories = [b];
    visibleChanged.fire(); active.set({ repository: b }, undefined);
    assert.equal(count, 10, 'selection must not change the workspace count');
    a.provider.count.set(5, undefined);
    assert.equal(count, 12, 'changes in an unselected repository update the badge');
    repositories.set('c', c); added.fire(c);
    assert.equal(count, 16, 'new repositories and resource-count fallback');
    c.provider.resources.set(6, undefined);
    assert.equal(count, 18, 'resource-count fallback updates');
    repositories.delete('b'); removed.fire(b);
    assert.equal(count, 11, 'removed repositories stop contributing');
    mode.set('focused', undefined); active.set({ repository: a }, undefined);
    assert.equal(count, 5, 'focused mode is preserved');
    mode.set('off', undefined);
    assert.equal(count, 0, 'off mode is preserved');
    mode.set('all', undefined);
    repositories.clear(); removed.fire(a); removed.fire(c);
    assert.equal(count, 0, 'empty workspace');
    subscription.dispose(); added.dispose(); removed.dispose(); visibleChanged.dispose();
    execFileSync('git', ['apply', '--reverse', patch], { cwd: dir });
    assert.deepEqual(fs.readFileSync(file), original);
    console.log('PASS: patch applies/reverses; all repositories, selection, live updates, add/remove, fallback, focused/off and empty workspace.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
