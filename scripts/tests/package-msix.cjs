const assert = require('node:assert/strict');
const { test } = require('node:test');
const { manifest, msixVersion, packageMsix } = require('../package-msix.cjs');

const identity = { identityName: 'AraraCode.AraraCode', publisher: 'CN=publisher', publisherDisplayName: 'Arara Code', version: '1.2.3.0' };

test('Code preserves its application identity, executable, protocol and languages', () => {
  const xml = manifest({ ...identity, product: { nameLong: 'Arara Code', nameShort: 'AraraCode', urlProtocol: 'arara-code' } });
  assert.match(xml, /Id="AraraCode" Executable="AraraCode.exe"/);
  assert.match(xml, /<uap:Protocol Name="arara-code">/);
  for (const language of ['pt-BR', 'en-US', 'es-ES']) assert.ok(xml.includes(`Language="${language}"`));
  assert.match(xml, /Name="runFullTrust"/);
});

test('Vibes uses its own identity and executable without registering the Code protocol', () => {
  const xml = manifest({ ...identity, identityName: 'AraraCode.AraraVibes', applicationId: 'AraraVibes', product: { nameLong: 'Arara Vibes', nameShort: 'Arara Vibes' } });
  assert.match(xml, /Name="AraraCode.AraraVibes"/);
  assert.match(xml, /Id="AraraVibes" Executable="Arara Vibes.exe"/);
  assert.doesNotMatch(xml, /<Extensions>|windows.protocol|undefined/);
});

test('Store manifest escapes XML and versions reject unsupported releases', () => {
  const xml = manifest({ ...identity, publisherDisplayName: 'A&B', product: { nameLong: '<Vibes>', nameShort: 'A"B' } });
  assert.match(xml, /A&amp;B/);
  assert.match(xml, /&lt;Vibes&gt;/);
  assert.match(xml, /Executable="A&quot;B.exe"/);
  assert.equal(msixVersion('0.1.17592'), '0.1.17592.0');
  for (const version of ['1.2', '1.2.3-beta', '65536.0.0', '1.2.65536']) assert.throws(() => msixVersion(version));
  assert.throws(() => packageMsix('missing', 'missing', '1.2.3', {}), /MSIX_IDENTITY_NAME/);
});
