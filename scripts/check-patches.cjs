#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function validatePatch(text, file = 'patch') {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let oldLeft = 0, newLeft = 0, inHunk = false, seenHunk = false;
  const fail = (index, message) => { throw new Error(`${file}:${index + 1}: ${message}`); };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === '\\ No newline at end of file') continue;
    if (inHunk) {
      if (line.startsWith(' ')) { oldLeft--; newLeft--; }
      else if (line.startsWith('-')) oldLeft--;
      else if (line.startsWith('+')) newLeft--;
      else fail(index, `incomplete hunk (${oldLeft} old, ${newLeft} new lines remaining)`);
      if (oldLeft < 0 || newLeft < 0) fail(index, 'hunk contains more lines than declared');
      inHunk = oldLeft !== 0 || newLeft !== 0;
      continue;
    }
    const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (header) {
      oldLeft = Number(header[1] ?? 1);
      newLeft = Number(header[2] ?? 1);
      inHunk = oldLeft !== 0 || newLeft !== 0;
      seenHunk = true;
    } else if (seenHunk && /^[+ -]/.test(line) && !line.startsWith('+++ ') && !line.startsWith('--- ') && line.trim()) {
      fail(index, 'patch content outside a hunk; check the declared line counts');
    }
  }
  if (inHunk) fail(lines.length - 1, `truncated hunk (${oldLeft} old, ${newLeft} new lines remaining)`);
  if (!seenHunk) throw new Error(`${file}: no unified diff hunks`);
}

function checkDirectory(directory) {
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) count += checkDirectory(file);
    else if (entry.name.endsWith('.patch')) { validatePatch(fs.readFileSync(file, 'utf8'), file); count++; }
  }
  return count;
}

if (require.main === module) {
  const count = checkDirectory(path.resolve(__dirname, '../patches'));
  console.log(`PASS: ${count} patches have complete hunks and no ignored trailing content.`);
}
module.exports = { validatePatch, checkDirectory };
