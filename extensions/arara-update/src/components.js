'use strict';

const { newerVersion, versionPattern } = require('./version');

const COMPONENTS = [
  { name: 'arara-ai', id: 'arara.arara-ai' },
  { name: 'arara-bot', id: 'arara.arara-bot' },
  { name: 'arara-orchestra', id: 'arara.arara-orchestra' },
];
const DEFAULT_API_URL = 'https://api.code.app.br';
const DOWNLOAD_PATH = /^\/v1\/ide\/components\/download\/[\w-]{43}$/;
const MAX_COMPONENT_BYTES = 300 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function installedComponents(getExtension) {
  return COMPONENTS.flatMap(component => {
    const version = getExtension(component.id)?.packageJSON?.version;
    return typeof version === 'string' && versionPattern.test(version) ? [{ ...component, version }] : [];
  });
}

function componentsQuery(installed) {
  return installed.map(component => `${component.name}@${component.version}`).join(',');
}

function apiOrigin(setting) {
  const value = setting?.globalValue ?? setting?.defaultValue ?? DEFAULT_API_URL;
  try {
    const url = new URL(String(value));
    if (url.username || url.password) return null;
    if (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) return url.origin;
  } catch {}
  return null;
}

function engineSatisfied(range, version) {
  const match = /^(\^|>=)?(\d+\.\d+\.\d+)$/.exec(String(range));
  if (!match || !versionPattern.test(version)) return false;
  const minimum = match[2];
  if (newerVersion(minimum, version)) return false;
  return match[1] !== '^' || minimum.split('.')[0] === version.split('.')[0];
}

function componentUpdates(body, installed, { origin, vscodeVersion }) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.components)) return { hold: false, updates: [] };
  if (body.updateAvailable === true) return { hold: true, updates: [] };
  const updates = [];
  for (const component of installed) {
    const entry = body.components.find(item => item?.name === component.name);
    const download = entry?.download;
    if (!entry?.updateAvailable || !download || typeof entry.latest !== 'string' || !newerVersion(entry.latest, component.version)) continue;
    if (!engineSatisfied(entry.engine, vscodeVersion)) continue;
    if (typeof download.url !== 'string' || !DOWNLOAD_PATH.test(download.url) || !/^[a-f0-9]{64}$/.test(download.sha256)) continue;
    if (!Number.isSafeInteger(download.size) || download.size <= 0 || download.size > MAX_COMPONENT_BYTES) continue;
    updates.push({ name: component.name, id: component.id, current: component.version, version: entry.latest, url: new URL(download.url, origin).href, sha256: download.sha256, size: download.size });
  }
  return { hold: false, updates };
}

function pendingInstalls(updates, marker) {
  return updates.filter(update => marker?.[update.id]?.version !== update.version);
}

module.exports = { COMPONENTS, DEFAULT_API_URL, MAX_COMPONENT_BYTES, apiOrigin, componentUpdates, componentsQuery, engineSatisfied, installedComponents, pendingInstalls };
