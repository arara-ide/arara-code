const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara bot assets '));
const bot = path.join(dir, 'arara-bot');
const work = path.join(dir, 'work');
const dest = path.join(work, 'vscode/extensions/arara-bot');
const write = (file, text, mode) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, mode ? { mode } : undefined);
};

try {
  const source = fs.readFileSync(path.join(root, 'scripts/build.sh'), 'utf8');
  const embed = source.match(/^embed_arara_bot\(\) \{\n[\s\S]*?^\}/m)?.[0];
  assert.ok(embed, 'arara-bot staging function must exist');
  const script = path.join(dir, 'embed.sh');
  write(script, `set -euo pipefail\n${embed}\nembed_arara_bot\n`);
  for (const tool of ['npm', 'pnpm']) write(path.join(dir, 'bin', tool), '#!/bin/bash\nexit 0\n', 0o755);
  fs.mkdirSync(path.join(bot, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(bot, 'extension/node_modules'), { recursive: true });
  const assets = {
    'package.nls.json': '{"test":"Settings"}',
    'package.nls.pt-br.json': '{"test":"Configurações"}',
    'package.nls.es.json': '{"test":"Configuración"}',
    'package.json': JSON.stringify({ publisher: 'arara', name: 'arara-bot', main: './dist/extension.js' }),
    'LICENSE': 'Apache License',
    'NOTICE': 'Arara Bot',
    'dist/extension.js': '// extension bundle',
    'dist/hub.js': '// hub bundle',
    'dist/bridge.js': '// bridge bundle',
    'dist/webview.js': '// webview bundle',
    'media/arara-bot.svg': '<svg/>',
    'server/index.js': '// server bundle',
    'skills/a/SKILL.md': '# skill',
  };
  for (const [file, text] of Object.entries(assets)) write(path.join(bot, 'extension', file), text);
  write(path.join(bot, 'extension/src/extension.ts'), '// source');
  const env = { ...process.env, PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, ARARA_BOT_DIR: bot, WORK: work };
  const run = () => spawnSync('bash', [script], { env, encoding: 'utf8' });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  for (const [file, text] of Object.entries(assets)) {
    assert.equal(fs.readFileSync(path.join(dest, file), 'utf8'), text, file);
  }
  assert.ok(!fs.existsSync(path.join(dest, 'src')), 'sources stay out of the release');
  fs.unlinkSync(path.join(bot, 'extension/server/index.js'));
  assert.notEqual(run().status, 0, 'missing server bundle must fail the release');
  assert.ok(!fs.existsSync(path.join(dest, 'ui')), 'the old web UI is not shipped');
  console.log('PASS: release includes the Arara Bot extension, webview, hub and server, and fails if the server bundle is missing.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
