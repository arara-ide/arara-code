#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EXTENSIONS, buildExtension, stageExtension } = require('./extension-layout.cjs');

const APP_NAME = 'Arara Code';
const APP_ID = 'arara-code';
const AI_EXTENSION_ID = 'arara.arara-ai';

function installCandidates(platform = process.platform, home = os.homedir(), env = process.env) {
  if (platform === 'darwin') return [`/Applications/${APP_NAME}.app`, path.join(home, 'Applications', `${APP_NAME}.app`)].map(app => path.join(app, 'Contents', 'Resources', 'app'));
  if (platform === 'win32') return [path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', APP_ID), path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', APP_NAME), path.join(env.ProgramFiles || 'C:\\Program Files', APP_NAME)].map(dir => path.join(dir, 'resources', 'app'));
  return [`/usr/share/${APP_ID}`, `/opt/${APP_NAME}`, `/opt/${APP_ID}`, path.join(home, '.local', 'share', APP_ID)].map(dir => path.join(dir, 'resources', 'app'));
}

function appRoot(input) {
  const resolved = path.resolve(input);
  const options = [resolved, path.join(resolved, 'resources', 'app'), path.join(resolved, 'Contents', 'Resources', 'app')];
  const found = options.find(dir => fs.existsSync(path.join(dir, 'product.json')) && fs.existsSync(path.join(dir, 'extensions')));
  return found && fs.realpathSync.native(found);
}

function findInstallation(explicit, candidates = installCandidates()) {
  if (explicit) {
    const found = appRoot(explicit);
    if (!found) throw new Error(`No ${APP_NAME} installation at ${explicit}: expected product.json and extensions/ under resources/app.`);
    return found;
  }
  const found = candidates.find(dir => appRoot(dir));
  if (!found) throw new Error(`${APP_NAME} not found in:\n  ${candidates.join('\n  ')}\nPass the folder with --app <path>.`);
  return appRoot(found);
}

function parseArgs(argv) {
  const options = { only: [...EXTENSIONS], build: true, environment: 'production', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => { const next = argv[++i]; if (!next || next.startsWith('--')) throw new Error(`${arg} needs a value.`); return next; };
    if (arg === '--app') options.app = value();
    else if (arg === '--workspace') options.workspace = value();
    else if (arg === '--only') options.only = value().split(',').map(name => name.trim()).filter(Boolean).map(name => name.startsWith('arara-') ? name : `arara-${name}`);
    else if (arg === '--environment') options.environment = value();
    else if (arg === '--backup-dir') options.backupDir = value();
    else if (arg === '--skip-build') options.build = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  const unknown = options.only.filter(name => !EXTENSIONS.includes(name));
  if (unknown.length || !options.only.length) throw new Error(`--only accepts ${EXTENSIONS.map(name => name.replace('arara-', '')).join(', ')}.`);
  if (!['production', 'local'].includes(options.environment)) throw new Error('--environment accepts production or local.');
  return options;
}

function files(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  }).sort();
}

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function digest(dir) {
  return Object.fromEntries(files(dir).map(file => [file, sha256(path.join(dir, file))]));
}

function mismatches(expected, actual) {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  return [...keys].filter(key => expected[key] !== actual[key]).sort();
}

function assertWritable(dir) {
  try { fs.accessSync(dir, fs.constants.W_OK); }
  catch {
    const rerun = process.platform === 'win32' ? 'Open the terminal as administrator and run' : 'Run';
    const sudo = process.platform === 'win32' ? '' : 'sudo ';
    throw new Error(`No write permission in ${dir}. The local build is ready. ${rerun}: ${sudo}node scripts/update-installed.cjs --skip-build ${process.argv.slice(2).filter(arg => arg !== '--skip-build').join(' ')}`.trim());
  }
}

const elevated = () => typeof process.getuid === 'function' && process.getuid() === 0;

function userHome(env = process.env) {
  if (!elevated() || !env.SUDO_USER || !/^[\w.-]+$/.test(env.SUDO_USER)) return os.homedir();
  return process.platform === 'darwin' ? path.join('/Users', env.SUDO_USER) : path.join('/home', env.SUDO_USER);
}

function enableProposals(app, stagedAi, backup) {
  const productPath = path.join(app, 'product.json');
  const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
  const wanted = JSON.parse(fs.readFileSync(path.join(stagedAi, 'package.json'), 'utf8')).enabledApiProposals ?? [];
  const current = product.extensionEnabledApiProposals?.[AI_EXTENSION_ID] ?? [];
  const missing = wanted.filter(name => !current.includes(name));
  if (!missing.length) return [];
  fs.mkdirSync(backup, { recursive: true });
  fs.copyFileSync(productPath, path.join(backup, 'product.json'));
  product.extensionEnabledApiProposals = { ...product.extensionEnabledApiProposals, [AI_EXTENSION_ID]: [...current, ...missing] };
  fs.writeFileSync(productPath, JSON.stringify(product, null, '\t') + '\n');
  return missing;
}

function replaceExtension(staged, target, backup) {
  const next = `${target}.arara-next`;
  fs.rmSync(next, { recursive: true, force: true });
  fs.cpSync(staged, next, { recursive: true });
  if (fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.cpSync(target, backup, { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.renameSync(next, target);
}

function updateInstalled(options, log = console.log, build = buildExtension) {
  const workspace = path.resolve(options.workspace || path.join(__dirname, '..', '..'));
  const app = findInstallation(options.app);
  const extensionsDir = path.join(app, 'extensions');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = path.resolve(options.backupDir || path.join(userHome(), '.arara-code', 'local-update-backups'), stamp);
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-update-installed-'));
  const repos = Object.fromEntries(options.only.map(name => [name, path.join(workspace, name)]));
  const result = { app, backup: backupRoot, updated: [], proposals: [] };
  try {
    for (const [name, repo] of Object.entries(repos)) if (!fs.existsSync(path.join(repo, 'package.json'))) throw new Error(`${name} not found at ${repo}.`);
    log(`Installation: ${app}`);
    if (options.build && elevated()) throw new Error('Do not build as root: it leaves root-owned files in the repositories. Run without sudo first; it builds and tells you the next command.');
    for (const [name, repo] of Object.entries(repos)) {
      if (options.build) { log(`» Building ${name}…`); build(name, repo); }
      stageExtension(name, repo, path.join(stagingRoot, name), options.environment);
    }
    if (!options.dryRun) assertWritable(extensionsDir);
    if (options.dryRun) {
      for (const name of options.only) log(`would replace ${path.join(extensionsDir, name)} (${files(path.join(stagingRoot, name)).length} files)`);
      return result;
    }
    for (const name of options.only) {
      const staged = path.join(stagingRoot, name), target = path.join(extensionsDir, name);
      replaceExtension(staged, target, path.join(backupRoot, name));
      const bad = mismatches(digest(staged), digest(target));
      if (bad.length) throw new Error(`${name}: installed files differ from the local build: ${bad.slice(0, 5).join(', ')}`);
      result.updated.push(name);
      log(`✓ ${name}: ${files(target).length} files checked by SHA-256`);
    }
    if (options.only.includes('arara-ai')) result.proposals = enableProposals(app, path.join(stagingRoot, 'arara-ai'), backupRoot);
    if (result.proposals.length) log(`product.json: enabled API proposals ${result.proposals.join(', ')} for ${AI_EXTENSION_ID}`);
    log(`Backup: ${backupRoot}`);
    log(result.proposals.length ? `Close and reopen ${APP_NAME} to load the new product.json.` : `Run "Developer: Reload Window" in ${APP_NAME}, or close and reopen it.`);
    if (process.platform === 'darwin') log('macOS: changing files inside the app removes its signature seal; the next official update or DMG install restores it.');
    return result;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

const USAGE = `Usage: node scripts/update-installed.cjs [options]

Builds arara-ai, arara-bot and arara-orchestra from the sibling folders and replaces the copies
embedded in the installed ${APP_NAME} (Linux, macOS and Windows). Each replaced folder is backed up first.

  --app <path>           installation folder, .app bundle or resources/app (default: auto-detect)
  --only ai,bot,orchestra  update only these extensions
  --workspace <path>     folder with the arara-* repositories (default: parent of arara-code)
  --environment <name>   production (default) or local API and panel URLs for arara-ai
  --backup-dir <path>    backups root (default: ~/.arara-code/local-update-backups)
  --skip-build           use the current dist/ of each repository
  --dry-run              build and stage, but change nothing in the installation`;

module.exports = { digest, findInstallation, installCandidates, mismatches, parseArgs, updateInstalled };

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(USAGE);
    else updateInstalled(options);
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
