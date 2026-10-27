const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara release assets '));
const extension = path.join(dir, 'arara-ai');
const work = path.join(dir, 'work');
const dest = path.join(work, 'vscode/extensions/arara-ai');
const write = (file, text, mode) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, mode ? { mode } : undefined);
};

try {
  const source = fs.readFileSync(path.join(root, 'scripts/build.sh'), 'utf8');
  const embed = source.match(/^embed_arara_ai\(\) \{\n[\s\S]*?^\}/m)?.[0];
  assert.ok(embed, 'release staging function must exist');
  const script = path.join(dir, 'embed.sh');
  write(script, `set -euo pipefail\n${embed}\nembed_arara_ai\n`);
  write(path.join(dir, 'bin/npm'), '#!/bin/bash\nexit 0\n', 0o755);
  fs.mkdirSync(path.join(extension, 'node_modules'), { recursive: true });
  write(path.join(extension, 'package.json'), JSON.stringify({
    publisher: 'arara', name: 'arara-ai', main: './dist/extension.js',
    contributes: { configuration: { properties: { 'arara.apiUrl': {}, 'arara.webUrl': {} } } },
  }));
  const assets = {
    'package.nls.json': '{"test":"Settings"}',
    'package.nls.pt-br.json': '{"test":"Configurações"}',
    'package.nls.es.json': '{"test":"Configuración"}',
    'dist/extension.js': '// extension bundle',
    'media/chat.css': 'body {}',
    'media/marked.min.js': '// markdown',
    'themes/arara.json': '{}',
  };
  for (const [file, text] of Object.entries(assets)) write(path.join(extension, file), text);
  write(path.join(extension, 'dist/extension.js.map'), '{}');
  const env = { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
    ROOT: root, ARARA_AI_DIR: extension, WORK: work, ARARA_ENVIRONMENT: 'production' };
  const run = () => spawnSync('bash', [script], { env, encoding: 'utf8' });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  for (const [file, text] of Object.entries(assets)) {
    assert.equal(fs.readFileSync(path.join(dest, file), 'utf8'), text, file);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'package.json'))).araraEnvironment, 'production');
  assert.ok(!fs.existsSync(path.join(dest, 'dist/extension.js.map')));
  fs.unlinkSync(path.join(extension, 'dist/extension.js'));
  assert.notEqual(run().status, 0, 'missing extension bundle must fail the release');
  console.log('PASS: release includes arara-ai assets and fails if its bundle is missing.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
