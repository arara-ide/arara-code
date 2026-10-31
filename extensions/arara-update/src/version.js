'use strict';

const versionPattern = /^\d+\.\d+\.\d+$/;
const releaseVersionPattern = /^\d+\.\d+\.\d{5}$/;

function newerVersion(candidate, current) {
  if (!versionPattern.test(candidate) || !versionPattern.test(current)) return false;
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function productVersion(productJson) {
  try {
    const version = JSON.parse(productJson).version;
    return typeof version === 'string' && releaseVersionPattern.test(version) ? version : null;
  } catch {
    return null;
  }
}

module.exports = { versionPattern, newerVersion, productVersion };
