const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const upstream = require('./fixtures/background-window-upstream.json');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-background-patch-'));
const files = ['src/vs/platform/environment/common/argv.ts', 'src/vs/platform/environment/node/argv.ts', 'src/vs/platform/windows/electron-main/windowImpl.ts', 'src/vs/platform/windows/electron-main/windowsMainService.ts'];
try {
  for (const file of files) {
    const target = path.join(directory, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, upstream.files[file]);
  }
  execFileSync('git', ['apply', path.join(root, 'patches/code/0043-background-window.patch')], { cwd: directory });
  const code = fs.readFileSync(path.join(directory, files[2]), 'utf8');
  const focus = /\tfocus\(options\?: \{ mode: FocusMode \}\): void \{([\s\S]*?)\n\t\}\n/.exec(code)[1];
  const run = vm.runInNewContext(`(function(options){${focus}})`, { FocusMode: { Transfer: 0, Notify: 1, Force: 2 }, isMacintosh: false });
  for (const backgroundWindow of [false, true]) {
    const calls = [];
    const window = { backgroundWindow, doFocusWindow: () => calls.push('focus'), showNotifyFocus: () => calls.push('notify') };
    for (const mode of [0, 1, 2]) run.call(window, { mode });
    assert.deepEqual(calls, backgroundWindow ? [] : ['focus', 'notify', 'focus']);
  }
  const createOptions = /if \(this.backgroundWindow\) \{ options.show = false; options.skipTaskbar = true; \}/.exec(code)[0];
  const apply = vm.runInNewContext(`(function(options){${createOptions};return options})`);
  assert.deepEqual(JSON.parse(JSON.stringify(apply.call({ backgroundWindow: true }, { show: true, skipTaskbar: false }))), { show: false, skipTaskbar: true });
  assert.deepEqual(JSON.parse(JSON.stringify(apply.call({ backgroundWindow: false }, { show: true, skipTaskbar: false }))), { show: true, skipTaskbar: false });
  const activation = /if \(this.backgroundWindow && isMacintosh\) \{ electron.app.setActivationPolicy\('accessory'\); \}/.exec(code);
  assert.ok(activation, 'Background Mac host must not appear in the Dock');
  for (const backgroundWindow of [false, true]) for (const isMacintosh of [false, true]) {
    const calls = [];
    vm.runInNewContext(`(function(){${activation[0]}})`, { isMacintosh, electron: { app: { setActivationPolicy: policy => calls.push(policy) } } }).call({ backgroundWindow });
    assert.deepEqual(calls, backgroundWindow && isMacintosh ? ['accessory'] : []);
  }
  assert.ok(code.includes('if (!this.backgroundWindow) { this.applyState'));
  assert.ok(code.includes('if (!this.backgroundWindow && !this.environmentMainService.isBuilt'));
  assert.ok(fs.readFileSync(path.join(directory, files[3]), 'utf8').includes("background: !!configuration['background-window']"));
  console.log('PASS: background patch applied to upstream; native creation visibility, focus modes and foreground behavior');
} finally { fs.rmSync(directory, { recursive: true }); }
