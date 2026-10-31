const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const vscodium = path.join(root, 'upstream/vscodium');
const upstream = path.join(root, '.work/vscodium/vscode');
const esbuild = require(path.join(upstream, 'build/node_modules/esbuild'));
const { chromium } = require(process.env.PLAYWRIGHT_PATH || path.join(upstream, 'node_modules/playwright'));
const merge = (left, right) => JSON.parse(execFileSync('jq', ['-s', '.[0] * .[1]', left, right], { encoding: 'utf8' }));
const links = ['https://example.com/path?q=1#top', 'http://example.org', 'https://sub.domain.example.net:8443/a', 'https://xn--nxasmq6b.example/', 'https://203.0.113.7/report'];

function productDomains(directory) {
  const script = fs.readFileSync(path.join(vscodium, 'prepare_vscode.sh'), 'utf8');
  const vscodiumValue = script.match(/setpath_json "product" "linkProtectionTrustedDomains" '([^']+)'/);
  assert.ok(vscodiumValue, 'VSCodium no longer sets linkProtectionTrustedDomains in prepare_vscode.sh');
  const write = (name, value) => { const file = path.join(directory, name); fs.writeFileSync(file, JSON.stringify(value)); return file; };
  const branded = write('root-product.json', merge(path.join(vscodium, 'product.json'), path.join(root, 'branding/product.overlay.json')));
  const code = write('code-product.json', { nameShort: 'Code - OSS', linkProtectionTrustedDomains: JSON.parse(vscodiumValue[1]) });
  return { vscodium: JSON.parse(vscodiumValue[1]), final: merge(code, branded) };
}

function validatorBundle() {
  const result = esbuild.buildSync({
    stdin: {
      contents: [
        "export { OpenerValidatorContributions } from './trustedDomainsValidator.js';",
        "export { TrustedDomainService } from './trustedDomainService.js';",
        "export { IStorageService } from '../../../../platform/storage/common/storage.js';",
        "export { IProductService } from '../../../../platform/product/common/productService.js';",
        "export { IBrowserWorkbenchEnvironmentService } from '../../../services/environment/browser/environmentService.js';",
      ].join('\n'),
      resolveDir: path.join(upstream, 'src/vs/workbench/contrib/url/browser'), loader: 'ts',
    },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'araraLinkValidator', write: false,
    tsconfig: path.join(upstream, 'src/tsconfig.json'), logLevel: 'silent', loader: { '.css': 'empty' },
  });
  return result.outputFiles[0].text;
}

function openLinks({ domains, links, options }) {
  const api = globalThis.araraLinkValidator;
  const prompts = [];
  const storage = { get: () => undefined, onDidChangeValue: () => () => ({ dispose() {} }) };
  const product = { nameShort: 'Arara Code', linkProtectionTrustedDomains: domains };
  const services = new Map([[api.IStorageService, storage], [api.IProductService, product], [api.IBrowserWorkbenchEnvironmentService, { options: undefined }]]);
  const instantiation = { invokeFunction: fn => fn({ get: id => services.get(id) }) };
  const trusted = new api.TrustedDomainService(instantiation, storage);
  const dialog = { prompt: async prompt => { prompts.push(prompt.detail); return { result: false }; } };
  const validator = new api.OpenerValidatorContributions({ registerValidator() {} }, storage, dialog, product, {}, {}, {}, {}, instantiation,
    { getValue: () => true }, { isWorkspaceTrusted: () => false }, trusted);
  return Promise.all(links.map(link => validator.validateLink(link, options))).then(opened => ({ opened, prompts }));
}

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-link-protection-'));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const domains = productDomains(directory);
    assert.deepEqual(domains.final.linkProtectionTrustedDomains, ['*'], 'the Arara overlay must replace the VSCodium list after both merges');
    assert.equal(domains.final.nameShort, 'Arara Code');
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addScriptTag({ content: validatorBundle() });
    assert.deepEqual(errors, []);

    for (const options of [undefined, { fromWorkspace: true }]) {
      const arara = await page.evaluate(openLinks, { domains: domains.final.linkProtectionTrustedDomains, links: [...links, 'mailto:team@example.com'], options });
      assert.deepEqual(arara.opened, links.map(() => true).concat(true), 'every link must open without asking');
      assert.deepEqual(arara.prompts, [], 'no Open/Copy/Configure dialog may be shown');
    }

    const control = await page.evaluate(openLinks, { domains: domains.vscodium, links: ['https://example.com/path', 'https://open-vsx.org/extension/a/b'] });
    assert.deepEqual(control.opened, [false, true], 'control: the VSCodium list still asks for example.com and trusts Open VSX');
    assert.deepEqual(control.prompts, ['https://example.com/path']);
    console.log(`PASS: overlay replaces ${JSON.stringify(domains.vscodium)} with ["*"]; ${links.length} external links and mailto open without the dialog, inside and outside the workspace; control with the VSCodium list still shows it.`);
  } finally {
    await browser.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
