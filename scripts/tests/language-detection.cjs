const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { prepareLanguageDetection } = require('../prepare-language-detection.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '../..');
const upstream = path.join(root, '.work/vscodium/vscode');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-language-worker-'));
const library = 'node_modules/@vscode/vscode-languagedetection';

(async () => {
  fs.mkdirSync(path.join(directory, 'node_modules/@vscode'), { recursive: true });
  fs.cpSync(path.join(upstream, library), path.join(directory, library), { recursive: true });
  const original = fs.readFileSync(path.join(directory, library, 'dist/lib/index.js'));
  const output = prepareLanguageDetection(directory);
  const generated = fs.readFileSync(output);
  prepareLanguageDetection(directory);
  assert.deepEqual(fs.readFileSync(output), generated);
  assert.deepEqual(fs.readFileSync(path.join(directory, library, 'dist/lib/index.js')), original);
  const worker = `self.define = (_dependencies, factory) => { self.detector = factory(); }; self.define.amd = true;
self.onmessage = async event => {
  try {
    importScripts('/dist/lib/' + event.data.entry);
    const model = new self.detector.ModelOperations({ modelJsonLoaderFunc: async () => (await fetch('/model/model.json')).json(), weightsLoaderFunc: async () => (await fetch('/model/group1-shard1of1.bin')).arrayBuffer() });
    const result = await model.runModel('def greet(name):\\n    print("Hello " + name)\\n\\nfor item in range(10):\\n    greet(str(item))\\n');
    model.dispose();
    self.postMessage({ result, requireType: typeof self.require });
  } catch (error) { self.postMessage({ error: error.message }); }
};`;
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html>'); return; }
    if (req.url === '/worker.js') { res.setHeader('content-type', 'text/javascript'); res.end(worker); return; }
    const file = path.join(directory, library, req.url);
    if (!file.startsWith(path.join(directory, library) + path.sep)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const run = entry => page.evaluate(entry => new Promise((resolve, reject) => {
      const worker = new Worker('/worker.js');
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Language worker timed out')); }, 20000);
      worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
      worker.onerror = error => { clearTimeout(timer); worker.terminate(); reject(new Error(error.message)); };
      worker.postMessage({ entry });
    }), entry);
    const before = await run('index.js');
    assert.match(before.error, /require is not defined/);
    const after = await run('index.browser.js');
    assert.equal(after.error, undefined, after.error);
    assert.equal(after.result[0].languageId, 'py');
    assert.equal(after.requireType, 'undefined', 'Node require must not be exposed globally');
    const relative = 'src/vs/workbench/services/languageDetection/browser/languageDetectionWorkerServiceImpl.ts';
    const target = path.join(directory, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, execFileSync('git', ['show', `HEAD:${relative}`], { cwd: upstream }));
    const patch = path.join(root, 'patches/code/0035-language-detection-worker.patch');
    execFileSync('git', ['apply', '--check', patch], { cwd: directory });
    execFileSync('git', ['apply', patch], { cwd: directory });
    assert.equal((fs.readFileSync(target, 'utf8').match(/dist\/lib\/index.browser.js/g) || []).length, 2);
    for (const file of ['build.sh', 'dev.sh', 'prepare-fast.sh']) assert.ok(fs.readFileSync(path.join(root, 'scripts', file), 'utf8').includes('prepare-language-detection.cjs'));
    console.log('PASS: original worker reproduces require failure; prepared worker detects Python with the real model; no global require; idempotent preparation and patched resource paths.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
