const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '../..');
const version = '1.135.07340';
const dmgName = `AraraCode-darwin-universal-${version}.dmg`;

function fixture(t, fail = '', arm64Kerberos = 'x86_64 arm64') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arara universal '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'input');
  const output = path.join(directory, 'output');
  const bin = path.join(directory, 'bin');
  const tools = path.join(directory, 'tools');
  for (const folder of [input, bin, tools]) fs.mkdirSync(folder);
  fs.mkdirSync(path.join(tools, 'build'));
  for (const name of ['vscode-universal-bundler', 'minimatch']) {
    const dependency = path.join(tools, 'build/node_modules', name);
    fs.mkdirSync(dependency, { recursive: true });
    fs.writeFileSync(path.join(dependency, 'package.json'), '{}');
  }
  fs.writeFileSync(path.join(tools, 'product.json'), '{}');
  for (const arch of ['x64', 'arm64']) fs.writeFileSync(path.join(input, `AraraCode-darwin-${arch}-${version}.zip`), 'app fixture');
  assert.equal(spawnSync('tar', ['-czf', path.join(input, 'macos-merge-tools.tar.gz'), '-C', tools, '.']).status, 0);
  const log = path.join(directory, 'commands.jsonl');
  const mock = path.join(bin, 'command.cjs');
  fs.writeFileSync(mock, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify([name, ...args]) + '\\n');
if (name === process.env.FAIL_COMMAND) process.exit(1);
if (name === 'node' && args[0].endsWith('create-universal-app.ts')) fs.mkdirSync(path.join(args[1], 'VSCode-darwin-universal', 'Arara Code.app'), { recursive: true });
if (name === 'ditto') {
  if (args[0] === '-x') {
    fs.accessSync(args[2]);
    const binding = path.join(args.at(-1), 'Arara Code.app/Contents/Resources/app/node_modules.asar.unpacked/kerberos/build/Release/kerberos.node');
    fs.mkdirSync(path.dirname(binding), { recursive: true });
    fs.writeFileSync(binding, args.at(-1).endsWith('-arm64') ? process.env.ARM64_KERBEROS : 'x86_64');
  }
  fs.mkdirSync(args.at(-1), { recursive: true });
}
if (name === 'lipo') {
  const arches = fs.readFileSync(args[0], 'utf8').split(' ');
  if (args[1] === '-archs') process.stdout.write(arches.join(' '));
  if (args[1] === '-verify_arch' && !args.slice(2).every(arch => arches.includes(arch))) process.exit(1);
  if (args[1] === '-thin') {
    if (!arches.includes(args[2]) || arches.length < 2) process.exit(1);
    fs.writeFileSync(args.at(-1), args[2]);
  }
}
if (name === 'hdiutil' && args.includes('-o')) fs.writeFileSync(args[args.indexOf('-o') + 1], 'DMG fixture');
if (name === 'hdiutil' && args[0] === 'create') fs.writeFileSync(args.at(-1), 'DMG fixture');
`);
  fs.chmodSync(mock, 0o755);
  for (const command of ['npm', 'node', 'ditto', 'lipo', 'codesign', 'hdiutil']) fs.symlinkSync(mock, path.join(bin, command));
  const run = value => spawnSync('bash', [path.join(root, 'scripts/package-macos-universal.sh'), input, output, value ?? version], {
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, COMMAND_LOG: log, FAIL_COMMAND: fail, ARM64_KERBEROS: arm64Kerberos }, encoding: 'utf8',
  });
  return { input, output, run, commands: () => fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) };
}

test('packages both architectures through the upstream merger and produces only the universal DMG', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(fs.readdirSync(f.output), [dmgName]);
  const calls = f.commands();
  const extracts = calls.filter(([command, flag]) => command === 'ditto' && flag === '-x');
  assert.equal(extracts.length, 2);
  assert.ok(extracts[0].some(arg => arg.endsWith(`x64-${version}.zip`)));
  assert.ok(extracts[1].some(arg => arg.endsWith(`arm64-${version}.zip`)));
  assert.ok(calls.some(([command, file]) => command === 'node' && file.endsWith('/build/darwin/verify-macho.ts')));
  const image = calls.find(([command, action]) => command === 'hdiutil' && action === 'create');
  assert.ok(image);
  assert.equal(image[image.indexOf('-fs') + 1], 'HFS+');
  assert.equal(image[image.indexOf('-format') + 1], 'UDZO');
  assert.ok(!calls.some(([command, action]) => command === 'hdiutil' && action === 'makehybrid'));
  assert.ok(!calls.some(([command]) => command === 'npm'));
  assert.deepEqual(calls.at(-1), ['hdiutil', 'verify', path.join(f.output, dmgName)]);
  const signed = calls.findIndex(([command]) => command === 'codesign');
  const assembled = calls.findIndex(([command, file]) => command === 'node' && file.endsWith('create-universal-app.ts'));
  assert.ok(signed > assembled);
});

test('thins the already universal Silicon Kerberos binding before the upstream ASAR merger', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const calls = f.commands();
  const thin = calls.findIndex(([command, , flag]) => command === 'lipo' && flag === '-thin');
  const merge = calls.findIndex(([command, file]) => command === 'node' && file.endsWith('create-universal-app.ts'));
  assert.ok(thin >= 0 && thin < merge);
  assert.equal(calls[thin][3], 'arm64');
  assert.equal(calls.filter(([command, , flag]) => command === 'lipo' && flag === '-thin').length, 1);
  for (const arch of ['x86_64', 'arm64']) assert.ok(calls.some(([command, , flag, cpu]) => command === 'lipo' && flag === '-verify_arch' && cpu === arch));
});

test('keeps a thin Silicon binding intact and rejects a binding without arm64 before merging', t => {
  const thin = fixture(t, '', 'arm64');
  assert.equal(thin.run().status, 0);
  assert.ok(!thin.commands().some(([command, , flag]) => command === 'lipo' && flag === '-thin'));
  const invalid = fixture(t, '', 'x86_64');
  assert.notEqual(invalid.run().status, 0);
  assert.ok(!invalid.commands().some(([command]) => command === 'node'));
  assert.deepEqual(fs.readdirSync(invalid.output), []);
});

for (const command of ['lipo', 'node', 'codesign', 'hdiutil']) {
  test(`does not publish a DMG when ${command} fails`, t => {
    const f = fixture(t, command);
    assert.notEqual(f.run().status, 0);
    assert.deepEqual(fs.readdirSync(f.output), []);
  });
}

test('rejects unsafe versions and missing input artifacts', t => {
  const f = fixture(t);
  assert.notEqual(f.run('../unsafe').status, 0);
  fs.unlinkSync(path.join(f.input, 'macos-merge-tools.tar.gz'));
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(fs.readdirSync(f.output), []);
});

test('rejects merge tools without installed dependencies before extracting apps', t => {
  const f = fixture(t);
  const tools = path.join(path.dirname(f.input), 'tools');
  fs.rmSync(path.join(tools, 'build/node_modules'), { recursive: true });
  assert.equal(spawnSync('tar', ['-czf', path.join(f.input, 'macos-merge-tools.tar.gz'), '-C', tools, '.']).status, 0);
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(fs.readdirSync(f.output), []);
});

test('transports the installed upstream tools including hidden configuration and dependency files', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arara merge tools '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const files = ['build/darwin/create-universal-app.ts', 'build/darwin/verify-macho.ts', 'build/node_modules/vscode-universal-bundler/package.json', 'build/node_modules/minimatch/package.json', 'build/node_modules/.package-lock.json', 'build/.npmrc', 'product.json', 'package.json'];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    fs.writeFileSync(path.join(source, file), '{}');
  }
  const archive = path.join(directory, 'tools.tar.gz');
  const run = () => spawnSync('bash', [path.join(root, 'scripts/package-macos-tools.sh'), source, archive], { encoding: 'utf8' });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  assert.equal(listing.status, 0);
  for (const file of files) assert.ok(listing.stdout.split('\n').includes(file), file);
  fs.unlinkSync(archive);
  fs.unlinkSync(path.join(source, 'build/node_modules/vscode-universal-bundler/package.json'));
  assert.notEqual(run().status, 0);
  assert.ok(!fs.existsSync(archive));
});

test('macOS opts into upstream esbuild with a separate typecheck and a heap below runner memory', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/build-macos.yml'), 'utf8');
  assert.match(workflow, /ARARA_MACOS_ESBUILD: '1'/);
  assert.match(workflow, /MAX_OLD_SPACE_SIZE: '4096'/);
  assert.match(workflow, /scripts\/package-macos-tools.sh/);
  const build = fs.readFileSync(path.join(root, 'scripts/build.sh'), 'utf8');
  const mac = build.split('\nelse\n  . version.sh')[1];
  assert.ok(mac.includes('spawnTsgo("src/tsconfig.json", { taskName: "typecheck-macos", noEmit: true })'));
  assert.ok(mac.indexOf('typecheck-macos') < mac.indexOf('npm run gulp vscode-min-prepack'));
});

test('the compiler patch applies and enables esbuild only for an explicit opt-in', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arara esbuild config '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'build'));
  const file = path.join(directory, 'build/buildConfig.ts');
  fs.writeFileSync(file, '\n'.repeat(11) + 'export const useEsbuildTranspile = false;\n');
  const patch = path.join(root, 'patches/code/0040-macos-esbuild.patch');
  const apply = spawnSync('git', ['apply', patch], { cwd: directory, encoding: 'utf8' });
  assert.equal(apply.status, 0, apply.stderr);
  for (const [value, expected] of [['', 'false'], ['0', 'false'], ['1', 'true']]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', 'import { useEsbuildTranspile } from "./build/buildConfig.ts"; process.stdout.write(String(useEsbuildTranspile));'], {
      cwd: directory, env: { ...process.env, ARARA_MACOS_ESBUILD: value }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

test('stops before merging if either architecture archive is missing', t => {
  for (const arch of ['x64', 'arm64']) {
    const f = fixture(t);
    fs.unlinkSync(path.join(f.input, `AraraCode-darwin-${arch}-${version}.zip`));
    assert.notEqual(f.run().status, 0);
    assert.deepEqual(fs.readdirSync(f.output), []);
    assert.ok(!f.commands().some(([command]) => command === 'node'));
  }
});

test('publishes a single DMG only after both builds and real tests on both runners', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');
  const job = name => workflow.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [a-z][\\w-]*:|$(?![\\s\\S]))`, 'm'))?.[0];
  assert.match(job('macos-universal'), /needs: \[version, macos-x64, macos-arm64\]/);
  assert.match(job('macos-universal'), /dist\/\*\.dmg/);
  assert.match(job('test-macos-universal'), /runner: \[macos-15-intel, macos-15\]/);
  assert.match(job('test-macos-universal'), /scripts\/test-macos-dmg.sh/);
  assert.match(job('release-macos-universal'), /needs: \[version, test-macos-universal\]/);
  assert.equal(job('release-macos-x64'), undefined);
  assert.equal(job('release-macos-arm64'), undefined);
  for (const name of ['macos-x64', 'macos-arm64']) {
    assert.match(job(name), /github.ref == 'refs\/heads\/main' \|\| github.ref == 'refs\/heads\/development'/);
    for (const component of ['ai', 'bot', 'orchestra']) assert.ok(job(name).includes(`${component}: \${{ needs.version.outputs.${component} }}`));
  }
});


test('development delivers a checksummed universal artifact without publishing a release', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');
  assert.ok(workflow.includes('arara-code-development-macos-universal'));
  assert.ok(workflow.includes('shasum -a 256 *.dmg > SHA256SUMS'));
  assert.ok(workflow.includes('shasum -a 256 -c SHA256SUMS'));
  const release = workflow.split('  release-macos-universal:')[1];
  assert.match(release, /^\n    if: github.ref == 'refs\/heads\/main'\n/);
  assert.doesNotMatch(release, /heads\/development/);
});

test('the DMG smoke verifies architectures with the file before lipo flags and isolates every storage path', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arara smoke args '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = fs.readFileSync(path.join(root, 'scripts/test-macos-dmg.sh'), 'utf8');
  assert.ok(source.includes('mktemp -d "/tmp/arara-dmg-test.XXXXXX"'));
  const lipo = source.split('\n').find(line => line.startsWith('lipo '));
  const args = source.split('\n').find(line => line.startsWith('ISOLATED_ARGS='));
  assert.ok(lipo);
  assert.ok(args);
  const script = `set -euo pipefail\nlipo() { printf '%s\\n' "$@"; }\nAPP='/fixture app'\nEXECUTABLE='Arara Code'\nWORK='/tmp/fixture smoke'\n${lipo}\n${args}\nprintf '%s\\n' "\${ISOLATED_ARGS[@]}"\n`;
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout.trim().split('\n');
  assert.deepEqual(output.slice(0, 4), ['/fixture app/Contents/MacOS/Arara Code', '-verify_arch', 'x86_64', 'arm64']);
  const isolated = output.slice(4);
  for (const key of ['--user-data-dir', '--extensions-dir', '--shared-data-dir', '--agent-plugins-dir', '--agents-user-data-dir', '--agents-extensions-dir']) {
    const index = isolated.indexOf(key);
    assert.ok(index >= 0, key);
    assert.ok(isolated[index + 1].startsWith('/tmp/fixture smoke/'), key);
  }
  assert.equal(new Set(isolated.filter((_, index) => index % 2 === 1)).size, 6);
  assert.ok(source.includes('--version "${ISOLATED_ARGS[@]}"'));
  assert.ok(source.includes('"$APP/Contents/MacOS/$EXECUTABLE" "${ISOLATED_ARGS[@]}"'));
  assert.ok(source.includes('env -u ELECTRON_RUN_AS_NODE "$APP/Contents/MacOS/$EXECUTABLE"'));
});

test('the DMG smoke keeps socket paths short even when the system temporary path is long', t => {
  const source = fs.readFileSync(path.join(root, 'scripts/test-macos-dmg.sh'), 'utf8');
  const create = source.split('\n').find(line => line.startsWith('WORK='));
  const result = spawnSync('bash', ['-c', `${create}\nprintf '%s' "$WORK"`], {
    env: { ...process.env, TMPDIR: '/tmp/' + 'system-temporary-path/'.repeat(10) }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  t.after(() => fs.rmSync(result.stdout, { recursive: true, force: true }));
  assert.ok(result.stdout.startsWith('/tmp/arara-dmg-test.'));
  assert.ok(`${fs.realpathSync(result.stdout)}/profile/1.13-main.sock`.length < 103);
});
