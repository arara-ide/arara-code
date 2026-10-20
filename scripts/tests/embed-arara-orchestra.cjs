const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara orchestra release '));
const extension = path.join(dir, 'arara-orchestra');
const work = path.join(dir, 'work');
const dest = path.join(work, 'vscode/extensions/arara-orchestra');
const write = (file, text, mode) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, mode ? { mode } : undefined);
};

try {
  // Exercise the release staging function without downloading/building the IDE.
  const source = fs.readFileSync(path.join(root, 'scripts/build.sh'), 'utf8');
  const embed = source.match(/^embed_arara_orchestra\(\) \{\n[\s\S]*?^\}/m)?.[0];
  assert.ok(embed, 'release staging function must exist');
  const script = path.join(dir, 'embed.sh');
  write(script, `set -euo pipefail\n${embed}\nembed_arara_orchestra\n`);
  write(path.join(dir, 'bin/npm'), '#!/bin/bash\nexit 0\n', 0o755);
  fs.mkdirSync(path.join(extension, 'node_modules'), { recursive: true });
  write(path.join(extension, 'package.json'), JSON.stringify({ publisher: 'arara', name: 'arara-orchestra', main: './dist/extension.js', extensionDependencies: ['arara.arara-ai'] }));
  const assets = {
    'dist/extension.js': '// extension bundle',
    'dist/webview/webview.js': '// browser bundle',
    'media/orquestra.css': 'body {}',
    'media/marked.min.js': '// markdown',
  };
  for (const [file, text] of Object.entries(assets)) write(path.join(extension, file), text);
  write(path.join(extension, 'dist/extension.js.map'), '{}');
  const env = { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
    ROOT: root, ARARA_ORCHESTRA_DIR: extension, WORK: work, ARARA_ENVIRONMENT: 'production' };
  const run = () => spawnSync('bash', [script], { env, encoding: 'utf8' });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  for (const [file, text] of Object.entries(assets)) {
    assert.equal(fs.readFileSync(path.join(dest, file), 'utf8'), text, file);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dest, 'package.json'))).extensionDependencies, ['arara.arara-ai']);
  assert.ok(!fs.existsSync(path.join(dest, 'dist/extension.js.map')));
  fs.unlinkSync(path.join(extension, 'dist/webview/webview.js'));
  assert.notEqual(run().status, 0, 'missing webview bundle must fail the release');
  console.log('PASS: release includes Orquestra assets and fails if its bundle is missing.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
