const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '../..');
const patch = path.join(root, 'patches/code/0046-console-logger-eio-guard.patch');
const vscodeLog = path.join(root, '.work/vscodium/vscode/src/vs/platform/log/common/log.ts');

const upstreamFixture = [
  ...Array.from({ length: 87 }, () => ''),
  'let isConsoleForwarding = false;',
  'let isLogServiceConsoleEcho = false;',
  '',
  'function getConsoleMethod(method: ConsoleMethod): ConsoleMethodFn {',
  '\tswitch (method) {',
  "\t\tcase 'debug': return console.debug;",
  "\t\tcase 'error': return console.error;",
  "\t\tcase 'info': return console.info;",
  "\t\tcase 'log': return console.log;",
  "\t\tcase 'warn': return console.warn;",
  '\t}',
  '}',
  '',
  'function setConsoleMethod(method: ConsoleMethod, fn: ConsoleMethodFn): void {',
  '\tswitch (method) {',
  "\t\tcase 'debug': console.debug = fn; break;",
  "\t\tcase 'error': console.error = fn; break;",
  "\t\tcase 'info': console.info = fn; break;",
  "\t\tcase 'log': console.log = fn; break;",
  "\t\tcase 'warn': console.warn = fn; break;",
  '\t}',
  '}',
  '',
  'function logToConsole(method: ConsoleMethod, ...args: unknown[]): void {',
  '\tif (isConsoleForwarding) {',
  '\t\treturn;',
  '\t}',
  '\tisLogServiceConsoleEcho = true;',
  '\ttry {',
  '\t\tgetConsoleMethod(method).apply(console, args);',
  '\t} finally {',
  '\t\tisLogServiceConsoleEcho = false;',
  '\t}',
  '}',
  '',
].join('\n');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-console-eio-'));
try {
  const rel = 'src/vs/platform/log/common/log.ts';
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, upstreamFixture);
  execFileSync('git', ['apply', '--check', patch], { cwd: dir });
  execFileSync('git', ['apply', patch], { cwd: dir });
  const patched = fs.readFileSync(target, 'utf8');
  const snippet = patched.slice(patched.indexOf('let isConsoleForwarding'));
  const js = stripTypeScriptTypes(`type ConsoleMethod = 'debug' | 'error' | 'info' | 'log' | 'warn';\ntype ConsoleMethodFn = (...args: unknown[]) => void;\n${snippet}`);

  for (const code of ['EIO', 'EPIPE', 'ERR_STREAM_DESTROYED']) {
    let calls = 0;
    const fakeConsole = {
      debug() { calls++; },
      info() { calls++; },
      log() { calls++; },
      warn() { calls++; },
      error() {
        calls++;
        const err = new Error(`write ${code}`);
        err.code = code;
        throw err;
      },
    };
    const logToConsole = vm.runInNewContext(`${js}\nlogToConsole`, { console: fakeConsole });
    assert.doesNotThrow(() => logToConsole('error', 'boom'));
    assert.doesNotThrow(() => logToConsole('error', 'second'));
    assert.doesNotThrow(() => logToConsole('info', 'third'));
    assert.equal(calls, 1, `expected ${code} to disable console echo after first failure`);
  }

  let nonStreamCalls = 0;
  const throwingConsole = {
    debug() {},
    info() {},
    log() {},
    warn() {},
    error() {
      nonStreamCalls++;
      throw new TypeError('unexpected');
    },
  };
  const logNonStream = vm.runInNewContext(`${js}\nlogToConsole`, { console: throwingConsole });
  assert.throws(() => logNonStream('error', 'boom'), TypeError);
  assert.equal(nonStreamCalls, 1);

  if (fs.existsSync(vscodeLog)) {
    const real = fs.readFileSync(vscodeLog, 'utf8');
    if (!real.includes('isConsoleOutputBroken')) {
      const checkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-console-eio-real-'));
      try {
        const realTarget = path.join(checkDir, rel);
        fs.mkdirSync(path.dirname(realTarget), { recursive: true });
        fs.writeFileSync(realTarget, real);
        execFileSync('git', ['apply', '--check', patch], { cwd: checkDir });
      } finally {
        fs.rmSync(checkDir, { recursive: true, force: true });
      }
    }
  }
  console.log('PASS: console logger EIO/EPIPE guard patch applies cleanly and stops write EIO/EPIPE recursion');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
