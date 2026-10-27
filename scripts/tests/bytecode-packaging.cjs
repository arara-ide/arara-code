const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const siblings = path.resolve(root, '..');

function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c;
    }
  }
  return new RegExp(re + '$');
}

function vsceWouldInclude(ignoreText, relPath) {
  const rules = ignoreText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const negated = line.startsWith('!');
      return { negated, re: globToRegExp(negated ? line.slice(1) : line) };
    });
  let ignored = false;
  for (const rule of rules) {
    if (rule.re.test(relPath)) ignored = !rule.negated;
  }
  return !ignored;
}

function protectedBundles() {
  const build = fs.readFileSync(path.join(root, 'scripts/build.sh'), 'utf8');
  const call = build.match(/bytecode\/protect\.sh"[^\n]*\\\n([\s\S]*?)\n\}/);
  assert.ok(call, 'protect_arara_extensions must call protect.sh with a bundle list');
  const tokens = call[1].match(/"\$\{(ai|bot|orch)\}\/[^"]+"/g) || [];
  const dirByVar = { ai: 'arara-ai', bot: 'arara-bot', orch: 'arara-orchestra' };
  return tokens.map(token => {
    const [, varName, rel] = token.match(/"\$\{(ai|bot|orch)\}\/([^"]+)"/);
    return { extension: dirByVar[varName], rel };
  });
}

function sidecarFor(rel) {
  return rel + 'c';
}

const repoByExtension = {
  'arara-ai': { dir: path.join(siblings, 'arara-ai'), ignore: '.vscodeignore' },
  'arara-bot': { dir: path.join(siblings, 'arara-bot', 'extension'), ignore: '.vscodeignore' },
  'arara-orchestra': { dir: path.join(siblings, 'arara-orchestra'), ignore: '.vscodeignore' },
};

const bundles = protectedBundles();
assert.ok(bundles.length > 0, 'expected at least one protected bundle');

let checkedSidecars = 0;
let missingRepos = [];

for (const { extension, rel } of bundles) {
  const repo = repoByExtension[extension];
  assert.ok(repo, `unknown protected extension: ${extension}`);
  const bundlePath = path.join(repo.dir, rel);
  const ignorePath = path.join(repo.dir, repo.ignore);
  if (!fs.existsSync(repo.dir)) {
    missingRepos.push(extension);
    continue;
  }
  if (!fs.existsSync(ignorePath)) {
    continue;
  }
  const ignoreText = fs.readFileSync(ignorePath, 'utf8');
  const sidecar = sidecarFor(rel);
  assert.ok(
    vsceWouldInclude(ignoreText, rel),
    `${extension}/${repo.ignore} drops the bundle itself (${rel})`
  );
  assert.ok(
    vsceWouldInclude(ignoreText, sidecar),
    `${extension}/${repo.ignore} drops the bytecode sidecar ${sidecar}; the loader stub would ship without its .jsc and fail activation with ENOENT`
  );
  checkedSidecars++;
}

if (missingRepos.length) {
  console.log(`SKIP (repos ausentes): ${missingRepos.join(', ')}`);
}
assert.ok(checkedSidecars > 0, 'no .vscodeignore allowlist was checked; run from the Arara workspace with sibling repos present');
console.log(`PASS: ${checkedSidecars} bundle(s) protegido(s) têm seu .jsc preservado pela allowlist do .vscodeignore.`);
