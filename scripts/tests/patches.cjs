const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { stripTypeScriptTypes } = require('node:module');
const { validatePatch, checkDirectory } = require('../check-patches.cjs');
const root = path.resolve(__dirname, '../..');

const fixture = '--- /dev/null\n+++ b/example.ts\n@@ -0,0 +1,2 @@\n+if (true) {\n+}\n';
validatePatch(fixture);
validatePatch(fixture.replace(/\n/g, '\r\n'));
assert.throws(() => validatePatch(fixture.replace('+1,2', '+1,1')), /outside a hunk/);
assert.throws(() => validatePatch(fixture.replace('+1,2', '+1,3')), /incomplete hunk|truncated hunk/);
assert.throws(() => validatePatch('--- a/a\n+++ b/a\n@@ -1 +1 @@\n-before\n+after\n+ignored\n'), /outside a hunk/);
validatePatch('--- a/a\n+++ b/a\n@@ -1 +1 @@\n-before\n+after\n\\ No newline at end of file\n');
const count = checkDirectory(path.join(root, 'patches'));
const startupPatch = fs.readFileSync(path.join(root, 'patches/code/0020-startup-webview.patch'), 'utf8');
assert.ok(startupPatch.includes('placeholder.ariaLabel = product.nameLong;'));
assert.ok(startupPatch.includes('arara-contour'));
assert.ok(startupPatch.includes('prefers-reduced-motion'));
assert.ok(!startupPatch.includes('Welcome to Arara Code'));
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'branding/product.overlay.json'), 'utf8')).startupWebview.title, 'Arara Code');


const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-launcher-patch-'));
try {
  const file = 'src/vs/workbench/contrib/arara/electron-browser/araraTitleLauncher.contribution.ts';
  const patch = path.join(root, 'patches/code/0030-title-bar-launcher.patch');
  execFileSync('git', ['apply', `--include=${file}`, '--check', patch], { cwd: dir });
  execFileSync('git', ['apply', `--include=${file}`, patch], { cwd: dir });
  const cssFile = file.replace('.contribution.ts', '.css');
  execFileSync('git', ['apply', `--include=${cssFile}`, patch], { cwd: dir });
  const css = fs.readFileSync(path.join(dir, cssFile), 'utf8');
  assert.ok(css.includes('background-color: currentColor'));
  assert.ok(css.includes('M19.355 18.538'));
  assert.ok(css.includes('viewBox=\'0 0 24 24\''));
  const source = fs.readFileSync(path.join(dir, file), 'utf8');
  assert.doesNotThrow(() => stripTypeScriptTypes(source), 'the source applied by Git must parse');
  assert.ok(source.includes("id: 'arara.openSettings'"), 'preserves the settings menu contribution');
  assert.ok(source.includes('Arara settings'), 'preserves the localized English source message');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
execFileSync(process.execPath, [path.join(__dirname, 'optimized-statusbar.cjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(__dirname, 'background-window.cjs')], { stdio: 'inherit' });
console.log(`PASS: ${count} patches, invalid hunk regressions and actual launcher source applied by Git.`);
