#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const catalogs = Object.fromEntries(['en', 'pt', 'es'].map(locale => [locale, JSON.parse(fs.readFileSync(path.join(root, 'locales', `${locale}.json`), 'utf8'))]));
const keys = Object.keys(catalogs.en).sort();
const parameters = text => [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
for (const [locale, catalog] of Object.entries(catalogs)) {
  if (JSON.stringify(Object.keys(catalog).sort()) !== JSON.stringify(keys)) throw new Error(`Mismatched keys: ${locale}`);
  for (const key of keys) if (!catalog[key] || JSON.stringify(parameters(catalog[key])) !== JSON.stringify(parameters(catalogs.en[key]))) throw new Error(`Mismatched parameters: ${locale}: ${key}`);
}
const source = `/* Copyright (c) Arara Code contributors. Licensed under the MIT License. */
const catalogs: Record<string, Record<string, string>> = ${JSON.stringify(catalogs, null, '\t')};

export function localizeAraraMessage(message: string): string {
	const language = (globalThis._VSCODE_NLS_LANGUAGE ?? 'en').toLowerCase().split(/[-_]/)[0];
	const catalog = catalogs[language];
	return catalog && Object.hasOwn(catalog, message) ? catalog[message] : message;
}
`;
const header = `Arara Code: localize downstream messages through the native NLS locale.

Why a patch: upstream language packs do not contain keys added by downstream patches.
The supplement is limited to public UI messages; no extension/business logic belongs here.
Preserves upstream language packs, pseudo localization, formatting and English originals.
Generated catalogs: locales/{en,pt,es}.json; run node scripts/generate-localization.cjs.
Touches: src/vs/nls.ts and src/vs/araraNls.ts (generated).

`;
const patch = header + `--- /dev/null
+++ b/src/vs/araraNls.ts
@@ -0,0 +1,${source.trimEnd().split('\n').length} @@
${source.trimEnd().split('\n').map(line => '+' + line).join('\n')}
--- a/src/vs/nls.ts
+++ b/src/vs/nls.ts
@@ -5,2 +5,4 @@
 
+import { localizeAraraMessage } from './araraNls.js';
+
 export function getNLSMessages(): string[] {
@@ -95,3 +97,3 @@
 \t}
-\treturn _format(message, args);
+\treturn _format(localizeAraraMessage(message), args);
 }
@@ -107,3 +109,3 @@
 \t\tif (typeof fallback === 'string') {
-\t\t\treturn fallback;
+\t\t\treturn localizeAraraMessage(fallback);
 \t\t}
@@ -112,3 +114,3 @@
 \t}
-\treturn message;
+\treturn localizeAraraMessage(message);
 }
@@ -150,3 +152,3 @@
 \t} else {
-\t\tmessage = originalMessage;
+\t\tmessage = localizeAraraMessage(originalMessage);
 \t}
`;
const target = path.join(root, 'patches/code/0032-arara-localization.patch');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== patch) throw new Error('Localization patch is stale; run node scripts/generate-localization.cjs');
} else fs.writeFileSync(target, patch);
