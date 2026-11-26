const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFile, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '../..');
const patch = path.join(root, 'patches/code/0049-silent-git-fetch-credentials.patch');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-git-autofetch-'));
const gitEnvironment = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig'),
};
const git = (args, cwd = dir, env = {}) => execFileSync('git', args, {
  cwd,
  env: { ...gitEnvironment, ...env },
  timeout: 10000,
});

async function verifyCredentialManager(env) {
  const server = http.createServer((request, response) => {
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fixture"' }).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const remote = `protocol=http\nhost=127.0.0.1:${server.address().port}\n`;
    const credential = 'username=fixture\npassword=test-only\n';
    const run = (command, input) => new Promise(resolve => {
      const child = execFile('git', ['credential-manager', command], {
        cwd: dir,
        env: {
          ...gitEnvironment,
          ...env,
          GCM_PROVIDER: 'generic',
          GCM_ALLOW_UNSAFE_REMOTES: 'true',
          GCM_CREDENTIAL_STORE: 'plaintext',
          GCM_PLAINTEXT_STORE_PATH: path.join(dir, 'credentials'),
        },
        timeout: 10000,
      }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
      child.stdin.end(input);
    });
    const missing = await run('get', remote + '\n');
    assert.equal(typeof missing.error?.code, 'number', missing.error?.message);
    assert.equal(missing.stdout, '');
    const store = await run('store', remote + credential + '\n');
    assert.ifError(store.error);
    const cached = await run('get', remote + '\n');
    assert.ifError(cached.error);
    assert.match(cached.stdout, /^username=fixture\r?$/m);
    assert.match(cached.stdout, /^password=test-only\r?$/m);
    console.log('PASS: Git Credential Manager fails without prompting and reuses cached credentials.');
  } finally {
    server.close();
  }
}

async function verify() {
  const target = path.join(dir, 'extensions/git/src/git.ts');
  const fixture = [
    'async fetch(options: { remote?: string; all?: boolean; silent?: boolean } = {}) {',
    "\tconst args = ['fetch'];",
    '\tconst spawnOptions: { env?: Record<string, string> } = { env: {} };',
    '\t\tif (options.all) {',
    "\t\t\targs.push('--all');",
    '\t\t}',
    '',
    '\t\tif (options.silent) {',
    "\t\t\tspawnOptions.env!['VSCODE_GIT_FETCH_SILENT'] = 'true';",
    '\t\t}',
    '',
    '\treturn this.exec(args, spawnOptions);',
    '}',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, fixture);
  if (!process.argv.includes('--before')) {
    git(['apply', '--check', patch]);
    git(['apply', patch]);
  }
  const source = fs.readFileSync(target, 'utf8');
  const fetch = vm.runInNewContext(stripTypeScriptTypes('({' + source + '})')).fetch;
  const defaults = fs.readFileSync(path.join(root, 'patches/code/0003-default-settings-keybindings.patch'), 'utf8');
  assert.match(defaults, /'git\.autofetch': true,/);

  const origin = path.join(dir, 'origin');
  const checkout = path.join(dir, 'checkout');
  git(['init', '-b', 'main', origin]);
  const commit = () => git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false',
    'commit', '--allow-empty', '-m', 'fixture'], origin);
  commit();
  git(['clone', '--quiet', origin, checkout]);
  for (const options of [{ silent: true }, { silent: true, all: true }, {}]) {
    commit();
    await fetch.call({
      async exec(args, { env }) {
        assert.equal(env.GCM_INTERACTIVE, options.silent ? 'never' : undefined);
        assert.equal(env.GIT_TERMINAL_PROMPT, options.silent ? '0' : undefined);
        assert.equal(env.VSCODE_GIT_FETCH_SILENT, options.silent ? 'true' : undefined);
        assert.equal(args.includes('--all'), options.all === true);
        if (options.silent && !options.all && process.argv.includes('--gcm')) {
          await verifyCredentialManager(env);
        }
        git(args, checkout, env);
      },
    }, options);
    assert.equal(git(['rev-parse', 'refs/remotes/origin/main'], checkout).toString(), git(['rev-parse', 'HEAD'], origin).toString());
  }
  console.log('PASS: default, all-remote and manual fetches update a real Git checkout with the expected prompt policy.');
}

verify().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
