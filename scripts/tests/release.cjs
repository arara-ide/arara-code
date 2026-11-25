const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { dispatchArguments, main } = require('../release.cjs');

test('dispatches main with all platforms by default and selects every subset', () => {
  const base = ['workflow', 'run', 'build.yml', '-R', 'arara-ide/arara-code', '--ref', 'main'];
  assert.deepEqual(dispatchArguments([]), base);
  const platforms = ['MAC', 'LINUX', 'WINDOWS'];
  for (let mask = 1; mask < 8; mask++) {
    const selected = platforms.filter((_, index) => mask & (1 << index));
    assert.deepEqual(dispatchArguments([`--platform=${selected.join(',').toLowerCase()}`]), [
      ...base, ...platforms.flatMap(platform => ['-f', `${platform.toLowerCase()}=${selected.includes(platform)}`]),
    ]);
  }
});

test('rejects invalid, empty, repeated options and unknown arguments', () => {
  for (const args of [['--platform='], ['--platform=MAC,'], ['--platform=DARWIN'], ['--ref=development'], ['--platform=MAC', '--platform=LINUX']]) {
    assert.throws(() => dispatchArguments(args));
  }
});

test('calls gh without a shell and propagates failures', () => {
  assert.equal(main([], (command, args, options) => {
    assert.equal(command, 'gh');
    assert.deepEqual(args, dispatchArguments([]));
    assert.deepEqual(options, { stdio: 'inherit' });
    return { status: 3 };
  }), 3);
  assert.throws(() => main([], () => ({ error: new Error('missing gh') })), /missing gh/);
  assert.equal(main([], () => ({ status: null })), 1);
});

test('dry run never dispatches', () => {
  assert.equal(main(['--platform=MAC', '--dry-run'], () => assert.fail('unexpected dispatch')), 0);
});

test('workflow gates each platform while retaining independent releases', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/build.yml'), 'utf8');
  for (const [job, platform] of [['linux', 'linux'], ['windows', 'windows'], ['macos-x64', 'mac'], ['macos-arm64', 'mac']]) {
    const body = workflow.split(`\n  ${job}:\n`)[1].split(/\n  [\w-]+:\n/)[0];
    assert.ok(body.includes(`github.event.inputs.${platform} != 'false'`));
    assert.ok(workflow.includes(`      ${platform}:\n        description:`));
  }
  assert.ok(workflow.includes('needs: [version, linux]'));
  assert.ok(workflow.includes('needs: [version, windows, attest-windows]'));
});
