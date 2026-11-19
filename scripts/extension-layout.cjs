#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { applyEnvironment } = require('./apply-environment.cjs');

const LAYOUTS = {
  'arara-ai': {
    source: '.',
    build: [{ cwd: '.', install: ['npm', 'ci', '--no-audit', '--no-fund'], run: [['npm', 'run', '--silent', 'build']] }],
    manifest: 'release',
    files: ['dist/extension.js'],
    optional: ['README.md', '.vscodeignore'],
    dirs: ['media', 'themes'],
    required: ['dist/extension.js'],
  },
  'arara-bot': {
    source: 'extension',
    build: [
      { cwd: '.', install: ['pnpm', 'install', '--frozen-lockfile'], run: [['pnpm', 'build:server']] },
      { cwd: 'extension', install: ['npm', 'ci', '--no-audit', '--no-fund'], run: [['npm', 'run', '--silent', 'build'], ['npm', 'run', '--silent', 'stage']] },
    ],
    files: ['LICENSE', 'NOTICE', 'dist/extension.js', 'dist/hub.js', 'dist/bridge.js', 'dist/webview.js'],
    dirs: ['media', 'server', 'skills'],
    required: ['server/index.js', 'dist/webview.js'],
  },
  'arara-orchestra': {
    source: '.',
    build: [{ cwd: '.', install: ['npm', 'ci', '--no-audit', '--no-fund'], run: [['npm', 'run', '--silent', 'build']] }],
    files: ['dist/extension.js', 'dist/webview/webview.js'],
    dirs: ['media'],
    required: ['dist/extension.js', 'dist/webview/webview.js'],
  },
};

const EXTENSIONS = Object.keys(LAYOUTS);

function layout(name) {
  if (!Object.hasOwn(LAYOUTS, name)) throw new Error(`Unknown extension: ${name}. Use ${EXTENSIONS.join(', ')}.`);
  return LAYOUTS[name];
}

const extensionSource = (name, repo) => path.join(repo, layout(name).source);

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function runStep(command, cwd, spawn) {
  const result = spawn(command[0], command.slice(1), { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command.join(' ')} failed in ${cwd} (exit ${result.status})`);
}

function buildExtension(name, repo, spawn = spawnSync) {
  for (const step of layout(name).build) {
    const cwd = path.join(repo, step.cwd);
    if (!fs.existsSync(path.join(cwd, 'node_modules'))) runStep(step.install, cwd, spawn);
    for (const command of step.run) runStep(command, cwd, spawn);
  }
}

function stageExtension(name, repo, dest, environment = 'production') {
  const spec = layout(name);
  const src = extensionSource(name, repo);
  const absent = [...spec.files, ...spec.dirs].filter(file => !fs.existsSync(path.join(src, file)));
  if (absent.length) throw new Error(`${name}: missing release files: ${absent.join(', ')}`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  if (spec.manifest === 'release') {
    const manifest = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
    for (const key of ['dependencies', 'devDependencies', 'scripts']) delete manifest[key];
    fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    applyEnvironment(environment, path.join(dest, 'package.json'));
  } else {
    copyFile(path.join(src, 'package.json'), path.join(dest, 'package.json'));
  }
  for (const entry of fs.readdirSync(src)) if (/^package\.nls.*\.json$/.test(entry)) copyFile(path.join(src, entry), path.join(dest, entry));
  for (const file of spec.optional ?? []) if (fs.existsSync(path.join(src, file))) copyFile(path.join(src, file), path.join(dest, file));
  for (const file of spec.files) copyFile(path.join(src, file), path.join(dest, file));
  for (const dir of spec.dirs) fs.cpSync(path.join(src, dir), path.join(dest, dir), { recursive: true });
  const missing = spec.required.filter(file => !fs.existsSync(path.join(dest, file)) || !fs.statSync(path.join(dest, file)).size);
  if (missing.length) throw new Error(`${name}: missing release files: ${missing.join(', ')}`);
  return dest;
}

module.exports = { EXTENSIONS, LAYOUTS, buildExtension, extensionSource, stageExtension };

if (require.main === module) {
  try {
    const [command, name, repo, dest, environment, ...extra] = process.argv.slice(2);
    if (command === 'build' && name && repo && !dest) buildExtension(name, path.resolve(repo));
    else if (command === 'stage' && name && repo && dest && !extra.length) stageExtension(name, path.resolve(repo), path.resolve(dest), environment || 'production');
    else throw new Error('Usage: node extension-layout.cjs build <arara-ai|arara-bot|arara-orchestra> <repo> | stage <name> <repo> <dest> [production|local]');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
