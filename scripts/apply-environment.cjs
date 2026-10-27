#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const environments = {
  local: { api: 'http://localhost:7010', web: 'http://localhost:7210' },
  production: { api: 'https://api.code.app.br', web: 'https://arara.code.app.br' },
};

try {
  const [environment, manifestPath, ...extra] = process.argv.slice(2);
  if (!Object.hasOwn(environments, environment) || extra.length) {
    throw new Error('Usage: node apply-environment.cjs local|production [extension/package.json]');
  }
  const urls = environments[environment];
  if (manifestPath) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.publisher !== 'arara' || manifest.name !== 'arara-ai') {
      throw new Error('Expected the arara.arara-ai extension manifest');
    }
    const configuration = manifest.contributes?.configuration;
    const sections = Array.isArray(configuration) ? configuration : [configuration];
    for (const [key, value] of [['arara.apiUrl', urls.api], ['arara.webUrl', urls.web]]) {
      const property = sections.find(section => section?.properties?.[key])?.properties[key];
      if (!property) throw new Error(`Missing setting: ${key}`);
      property.default = value;
      if (key === 'arara.apiUrl' && !/^%[^%]+%$/.test(property.description ?? '')) {
        property.description = 'Arara Code server URL. A user-defined URL overrides the build default.';
      }
    }
    manifest.araraEnvironment = environment;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log(`Environment: ${environment}\nWeb: ${urls.web}\nAPI: ${urls.api}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
