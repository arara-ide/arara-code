#!/usr/bin/env node
'use strict';
// Compila bundles CommonJS para bytecode V8 (.jsc) e substitui o .js original por um
// carregador mínimo e autossuficiente (sem dependências externas — o build da IDE não
// embarca node_modules destas extensões).
//
// IMPORTANTE: o bytecode V8 só carrega na MESMA versão de V8 (e com os mesmos flags) que o
// gerou. Estas extensões rodam no Electron embarcado do Arara Code, então ESTE script DEVE
// ser executado com esse Electron (ELECTRON_RUN_AS_NODE=1 .build/electron/arara-code), nunca
// com o node do sistema. O carregador verifica a versão em tempo de carga e falha com erro
// claro se não bater.
//
// Compilamos com `--no-lazy` para que as funções internas entrem no bytecode (sem isso, V8
// adia a compilação de funções aninhadas e, no load, tentaria parsear o fonte-placeholder →
// erro). O carregador reativa `--no-lazy` na hora de construir o Script para que o hash de
// flags do cache confira.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const v8 = require('node:v8');
const Module = require('node:module');

// Cabeçalho próprio: [4 bytes magic "AJC1"][4 bytes LE: tamanho do fonte embrulhado]
// [N bytes: versão do V8 em ascii][1 byte 0x00][cachedData]. Independe do layout interno do
// header do V8, que muda entre versões do Node.
const MAGIC = Buffer.from('AJC1', 'ascii');

function compileOne(file) {
  const source = fs.readFileSync(file, 'utf8');
  const wrapped = Module.wrap(source); // (function (exports, require, module, __filename, __dirname) { ... });
  v8.setFlagsFromString('--no-lazy');
  let cachedData;
  try {
    const script = new vm.Script(wrapped, { filename: file, produceCachedData: true });
    cachedData = script.cachedData;
  } finally {
    v8.setFlagsFromString('--lazy');
  }
  if (!cachedData || cachedData.length === 0) {
    throw new Error(`V8 não produziu bytecode para ${file}`);
  }
  const v8ver = Buffer.from(process.versions.v8, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(wrapped.length, 0);
  const out = Buffer.concat([MAGIC, lenBuf, v8ver, Buffer.from([0]), cachedData]);

  const dir = path.dirname(file);
  const base = path.basename(file);
  const jscName = base + 'c'; // extension.js -> extension.jsc ; core.cjs -> core.cjsc
  fs.writeFileSync(path.join(dir, jscName), out);

  // Substitui o fonte legível pelo carregador, inlinado para não depender de pacote algum.
  fs.writeFileSync(file, loaderStub(jscName));
  return { file, jsc: jscName, bytes: out.length, srcBytes: Buffer.byteLength(source) };
}

function loaderStub(jscName) {
  return `'use strict';
// Carregador de bytecode V8 gerado pelo build do Arara Code. Não edite à mão.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const v8 = require('node:v8');
const jscPath = path.join(__dirname, ${JSON.stringify(jscName)});
const buf = fs.readFileSync(jscPath);
if (buf.length < 9 || buf.toString('ascii', 0, 4) !== 'AJC1') {
  throw new Error('Bytecode do Arara Code corrompido ou em formato desconhecido: ' + jscPath);
}
const srcLen = buf.readUInt32LE(4);
let p = 8; while (p < buf.length && buf[p] !== 0) p++;
const builtV8 = buf.toString('ascii', 8, p);
const cachedData = buf.subarray(p + 1);
if (builtV8 !== process.versions.v8) {
  throw new Error(
    'Bytecode do Arara Code incompatível com este runtime.\\n' +
    '  gerado para V8: ' + builtV8 + '\\n' +
    '  V8 atual:       ' + process.versions.v8 + '\\n' +
    'Rebuild necessário: gere o bytecode com o Electron embarcado desta versão da IDE.'
  );
}
const dummy = srcLen > 1 ? '"' + '\\u200b'.repeat(srcLen - 2) + '"' : '""';
v8.setFlagsFromString('--no-lazy');
let script;
try {
  script = new vm.Script(dummy, { filename: __filename, cachedData });
} finally {
  v8.setFlagsFromString('--lazy');
}
if (script.cachedDataRejected) {
  throw new Error('Bytecode do Arara Code rejeitado pelo V8 (cachedDataRejected) em ' + jscPath + '. Rebuild necessário.');
}
const fn = script.runInThisContext();
fn(module.exports, require, module, __filename, __dirname);
`;
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('uso: compile-bytecode.cjs <arquivo.js> [...]  (rode sob o Electron embarcado)');
    process.exit(2);
  }
  const underElectron = !!process.versions.electron;
  for (const f of files) {
    const r = compileOne(f);
    console.log(`» bytecode ${r.file} -> ${r.jsc} (${r.srcBytes}B fonte → ${r.bytes}B jsc)`);
  }
  console.log(`V8 alvo: ${process.versions.v8}${underElectron ? ' (electron ' + process.versions.electron + ')' : ' (NÃO é Electron — confira o runtime!)'}`);
}

main();
