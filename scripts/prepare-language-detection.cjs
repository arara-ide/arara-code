const fs = require('node:fs');
const path = require('node:path');

function prepareLanguageDetection(vscode) {
  const directory = path.join(vscode, 'node_modules/@vscode/vscode-languagedetection/dist/lib');
  const source = fs.readFileSync(path.join(directory, 'index.js'), 'utf8');
  const files = fs.readdirSync(directory).filter(file => file.endsWith('.js') && file !== 'index.js' && file !== 'index.browser.js');
  const factories = files.map(file => `${JSON.stringify('./' + file)}: () => { const module = { exports: {} }; const exports = module.exports;\n${fs.readFileSync(path.join(directory, file), 'utf8')}\nreturn module.exports; }`);
  const bundle = `(() => { const chunks = { ${factories.join(',\n')} }; const loaded = Object.create(null); const require = id => { if (!Object.hasOwn(chunks, id)) throw new Error('Unsupported language detection dependency: ' + id); return loaded[id] ??= chunks[id](); };\n${source}\n})();\n`;
  const output = path.join(directory, 'index.browser.js');
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== bundle) fs.writeFileSync(output, bundle);
  return output;
}

module.exports = { prepareLanguageDetection };
if (require.main === module) {
  const vscode = process.argv[2];
  if (!vscode) throw new Error('Expected the Code-OSS source directory.');
  prepareLanguageDetection(path.resolve(vscode));
}
