const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, '../arara-ai/node_modules/typescript'));
const sourceRoot = process.env.ARARA_UPSTREAM_SOURCE || path.join(root, '.work/vscodium/vscode');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-start-screen-'));
(async () => {
  let browser;
  try {
    const relative = 'src/vs/workbench/browser/parts/editor/editorGroupWatermark.ts';
    const layout = 'src/vs/workbench/browser/layout.ts';
    for (const file of [relative, layout]) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.copyFileSync(path.join(sourceRoot, file), path.join(dir, file));
    }
    if (!process.argv.includes('--before')) {
      const patch = path.join(root, 'patches/code/0039-empty-window-navigation.patch');
      execFileSync('git', ['apply', '--check', patch], { cwd: dir });
      execFileSync('git', ['apply', patch], { cwd: dir });
    }
    const source = fs.readFileSync(path.join(dir, relative), 'utf8');
    const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
    assert.deepEqual(ast.parseDiagnostics, []);
    const cls = ast.statements.find(node => ts.isClassDeclaration(node));
    const method = cls.members.find(node => node.name?.getText(ast) === 'renderContent').getText(ast);
    const selection = method.slice(method.indexOf('{') + 1, method.indexOf('const keyLabels'));
    let provider;
    let tips = false;
    let state = 1;
    const errors = [];
    const owner = { _store: { isDisposed: false }, configurationService: { getValue: () => tips }, commandService: { executeCommand: async () => provider() }, get workbenchState() { return state; } };
    const context = { owner, WorkbenchState: { EMPTY: 1 }, EditorGroupWatermark: { START_COMMAND: 'arara.startScreen' }, CommandsRegistry: { getCommand: () => provider }, localize: (_key, message) => message, onUnexpectedError: error => errors.push(error) };
    const choose = ts.transpileModule(`(async function() { ${selection} return sections; }).call(owner)`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const select = () => vm.runInNewContext(choose, context);
    const fallback = await select();
    assert.equal(fallback?.[0].action.id, 'workbench.action.files.openFolder', 'empty windows offer opening a folder even with tips disabled and no provider');
    assert.equal(fallback[0].entries[0].id, 'workbench.action.openRecent');
    provider = async () => { throw new Error('provider unavailable'); };
    assert.equal((await select())[0].action.id, fallback[0].action.id);
    assert.equal(errors.length, 1);
    provider = async () => [];
    assert.equal((await select())[0].entries.length, 1);
    provider = async () => undefined;
    assert.equal((await select())[0].entries.length, 1);
    provider = async () => [{ title: 'Projects', entries: [{ id: 'project.open', text: 'demo', args: ['file:///demo'] }] }];
    assert.equal((await select())[0].entries[0].text, 'demo');
    state = 2;
    assert.equal(await select(), undefined, 'workspace tips preference is preserved');
    tips = true;
    assert.equal((await select())[0].entries[0].text, 'demo');
    const layoutSource = fs.readFileSync(path.join(dir, layout), 'utf8');
    const defaultExpression = layoutSource.match(/LayoutStateKeys.SIDEBAR_HIDDEN.defaultValue = (.*);/)[1];
    for (const force of [false, true]) {
      assert.equal(vm.runInNewContext(defaultExpression, { auxiliaryBarForceMaximized: force, workbenchState: 1, WorkbenchState: { EMPTY: 1 } }), force);
    }
    console.log('PASS: 9 start-screen and initial Explorer regressions; patch applied by Git and TypeScript parsed.');
    if (!process.argv.includes('--browser')) return;
    const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage();
    const compiled = ts.transpileModule(`class Fixture { ${method} }; globalThis.Fixture = Fixture;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    for (const locale of ['en', 'pt', 'es']) {
      await page.setContent('<main id="start"></main>');
      await page.evaluate(({ compiled, catalog }) => {
        globalThis.CommandsRegistry = { getCommand: () => undefined };
        globalThis.WorkbenchState = { EMPTY: 1 };
        globalThis.EditorGroupWatermark = { START_COMMAND: 'arara.startScreen', SETTINGS_KEY: 'workbench.tips.enabled' };
        globalThis.localize = (_key, message) => catalog[message] || message;
        globalThis.onUnexpectedError = error => { throw error; };
        globalThis.$ = (selector, attrs = {}) => {
          const [tag, ...classes] = selector.split('.');
          const element = document.createElement(tag || 'div');
          element.className = classes.join(' ');
          Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
          return element;
        };
        globalThis.append = (parent, child) => parent.appendChild(child);
        globalThis.reset = (parent, child) => parent.replaceChildren(child);
        globalThis.clearNode = node => node.replaceChildren();
        globalThis.EventType = { CLICK: 'click' };
        globalThis.addDisposableListener = (node, event, listener) => { node.addEventListener(event, listener); return {}; };
        (0, eval)(compiled);
        const store = { clear() {}, add(value) { return value; } };
        globalThis.calls = [];
        const owner = new Fixture();
        Object.assign(owner, { _store: { isDisposed: false }, workbenchState: 1, configurationService: { getValue: () => false }, transientDisposables: store, keybindingLabels: store, keybindingService: { lookupKeybinding: () => undefined }, productService: { nameLong: 'Arara Code' }, shortcuts: document.querySelector('#start'), commandService: { executeCommand: async id => calls.push(id) }, render() {} });
        return owner.renderContent();
      }, { compiled, catalog: JSON.parse(fs.readFileSync(path.join(root, `locales/${locale}.json`))) });
      assert.equal(await page.locator('button').count(), 2);
      await page.locator('.arara-start-primary').click();
      await page.locator('.arara-start-item').click();
      assert.deepEqual(await page.evaluate(() => calls), ['workbench.action.files.openFolder', 'workbench.action.openRecent']);
    }
    console.log('PASS: Chromium renders the actual watermark method and clicks both fallback actions in en/pt/es.');
  } finally {
    await browser?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
