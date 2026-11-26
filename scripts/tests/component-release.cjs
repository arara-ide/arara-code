#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const { once } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '../..');
const { componentManifest, oidcToken, packageComponent, publishComponent, vsixManifest } = require(path.join(root, 'scripts/component-release.cjs'));
const { stageExtension } = require(path.join(root, 'scripts/extension-layout.cjs'));

test('componentManifest validates the staged manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'component-manifest-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ publisher: 'arara', name: 'arara-ai', version: '1.2.3', engines: { vscode: '^1.134.0' } }));
    const manifest = componentManifest('arara-ai', dir);
    assert.equal(manifest.version, '1.2.3');

    assert.throws(() => componentManifest('unknown-ext', dir), /Unknown component/);

    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ publisher: 'other', name: 'arara-ai', version: '1.2.3', engines: { vscode: '^1.134.0' } }));
    assert.throws(() => componentManifest('arara-ai', dir), /Expected the arara\.arara-ai manifest/);

    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ publisher: 'arara', name: 'arara-ai', version: 'nope', engines: { vscode: '^1.134.0' } }));
    assert.throws(() => componentManifest('arara-ai', dir), /Invalid version/);

    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ publisher: 'arara', name: 'arara-ai', version: '1.0.0', engines: { vscode: 'latest' } }));
    assert.throws(() => componentManifest('arara-ai', dir), /Invalid engines\.vscode/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('vsixManifest produces valid XML with the right fields', () => {
  const xml = vsixManifest({ name: 'arara-ai', version: '1.0.0', displayName: 'Arara AI', description: 'The <best> & "only"', publisher: 'arara', engines: { vscode: '^1.134.0' } });
  assert.ok(xml.includes('Id="arara-ai"'));
  assert.ok(xml.includes('Version="1.0.0"'));
  assert.ok(xml.includes('Publisher="arara"'));
  assert.ok(xml.includes('The &lt;best&gt; &amp; &quot;only&quot;'));
  assert.ok(xml.includes('Microsoft.VisualStudio.Code.Engine'));
});

test('packageComponent creates a VSIX with metadata sidecar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'component-package-'));
  try {
    const staged = path.join(dir, 'staged');
    fs.mkdirSync(staged, { recursive: true });
    fs.writeFileSync(path.join(staged, 'package.json'), JSON.stringify({ publisher: 'arara', name: 'arara-ai', version: '0.5.0', displayName: 'Arara AI', engines: { vscode: '^1.134.0' } }));
    fs.mkdirSync(path.join(staged, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(staged, 'dist/extension.js'), 'module.exports = {}');

    const out = path.join(dir, 'arara.arara-ai-0.5.0.vsix');
    const metadata = packageComponent('arara-ai', staged, out);

    assert.equal(metadata.name, 'arara-ai');
    assert.equal(metadata.id, 'arara.arara-ai');
    assert.equal(metadata.version, '0.5.0');
    assert.equal(metadata.engine, '^1.134.0');
    assert.ok(fs.existsSync(out));
    assert.ok(metadata.size > 0);
    assert.ok(/^[a-f0-9]{64}$/.test(metadata.sha256));
    assert.equal(metadata.sha256, crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex'));

    const sidecar = JSON.parse(fs.readFileSync(`${out}.json`, 'utf8'));
    assert.deepEqual(sidecar, metadata);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('oidcToken fetches from the GitHub OIDC endpoint', async () => {
  const server = http.createServer((req, res) => {
    assert.ok(req.url.includes('audience=arara-components'));
    assert.ok(req.headers.authorization.startsWith('bearer '));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ value: 'mock-jwt-token' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const env = {
      ACTIONS_ID_TOKEN_REQUEST_URL: `http://127.0.0.1:${server.address().port}/token`,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-token',
    };
    const token = await oidcToken(env);
    assert.equal(token, 'mock-jwt-token');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }

  await assert.rejects(() => oidcToken({}), /GitHub OIDC is unavailable/);
});

test('publishComponent sends the VSIX and handles 201/409', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'component-publish-'));
  try {
    const staged = path.join(dir, 'staged');
    fs.mkdirSync(staged, { recursive: true });
    fs.writeFileSync(path.join(staged, 'package.json'), JSON.stringify({ publisher: 'arara', name: 'arara-ai', version: '0.6.0', displayName: 'Arara AI', engines: { vscode: '^1.134.0' } }));
    fs.mkdirSync(path.join(staged, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(staged, 'dist/extension.js'), 'module.exports = {}');

    const vsix = path.join(dir, 'arara.arara-ai-0.6.0.vsix');
    packageComponent('arara-ai', staged, vsix);

    let requestCount = 0;
    const received = [];
    const server = http.createServer(async (req, res) => {
      requestCount++;
      if (req.url.includes('/token')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ value: 'jwt' }));
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received.push({ url: req.url, size: Buffer.concat(chunks).length });
      if (requestCount <= 3) {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'arara-ai', version: '0.6.0' }));
      } else {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ statusCode: 409, code: 'component_version_not_newer', message: 'already published' }));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    try {
      const env = {
        ACTIONS_ID_TOKEN_REQUEST_URL: `http://127.0.0.1:${port}/token`,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner',
      };
      const result = await publishComponent(vsix, { api: `http://127.0.0.1:${port}`, env });
      assert.equal(result.status, 'published');
      assert.equal(result.version, '0.6.0');
      assert.ok(received[0].url.includes('/v1/ide/components/arara-ai/releases'));
      assert.ok(received[0].size > 0);

      requestCount = 10;
      const unchanged = await publishComponent(vsix, { api: `http://127.0.0.1:${port}`, env });
      assert.equal(unchanged.status, 'unchanged');
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }

    await assert.rejects(
      () => publishComponent(vsix, { api: 'https://evil.example' }),
      /OIDC is unavailable/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log('component-release.cjs: all assertions passed');
