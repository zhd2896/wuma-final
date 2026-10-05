import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const expectedPages = ['login', 'index', 'game', 'analysis', 'review', 'coach',
  'training', 'history', 'profile', 'online'];

function writeUnit(parent: string, name: string, wxml = '<view />') {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  const base = join(dir, name);
  writeFileSync(`${base}.json`, '{}');
  writeFileSync(`${base}.wxml`, wxml);
  writeFileSync(`${base}.wxss`, '');
  writeFileSync(`${base}.ts`, '');
}

function runCheck(root: string): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, ['scripts/check.cjs'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, WUMA_CHECK_ROOT: root },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error: any) {
    return {
      status: error.status ?? 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

test('source checker accepts native radio controls and still rejects unknown tags', () => {
  const root = mkdtempSync(join(tmpdir(), 'wuma-source-check-'));
  try {
    const mini = join(root, 'miniprogram');
    const pages = join(mini, 'pages');
    const components = join(mini, 'components');
    mkdirSync(pages, { recursive: true });
    mkdirSync(components, { recursive: true });
    writeFileSync(join(mini, 'app.json'), JSON.stringify({
      pages: expectedPages.map(name => `pages/${name}/${name}`),
    }));
    for (const name of expectedPages) writeUnit(pages, name);
    writeUnit(components, 'native-controls',
      '<view><radio-group><label><radio value="A" /></label></radio-group></view>');

    const nativeResult = runCheck(root);
    assert.equal(nativeResult.status, 0, nativeResult.output);

    writeFileSync(join(components, 'native-controls', 'native-controls.wxml'),
      '<view><mystery-widget /></view>');
    const unknownResult = runCheck(root);
    assert.equal(unknownResult.status, 1);
    assert.match(unknownResult.output, /unknown WXML tag <mystery-widget> in native-controls/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source checker validates subpackage routes, events and image assets', () => {
  const root = mkdtempSync(join(tmpdir(), 'wuma-subpackage-check-'));
  try {
    const mini = join(root, 'miniprogram');
    const pages = join(mini, 'pages');
    const components = join(mini, 'components');
    const guidePages = join(mini, 'guide', 'pages');
    mkdirSync(pages, { recursive: true });
    mkdirSync(components, { recursive: true });
    mkdirSync(guidePages, { recursive: true });
    writeFileSync(join(mini, 'app.json'), JSON.stringify({
      pages: expectedPages.map(name => `pages/${name}/${name}`),
      subPackages: [{ root: 'guide', pages: ['pages/rules/rules'] }],
    }));
    for (const name of expectedPages) writeUnit(pages, name);
    writeFileSync(join(pages, 'index', 'index.ts'),
      "const route = '/guide/pages/rules/rules';");

    const missingPage = runCheck(root);
    assert.equal(missingPage.status, 1);
    assert.match(missingPage.output, /app page does not exist: guide\/pages\/rules\/rules/);

    writeUnit(guidePages, 'rules', '<image src="../../assets/rules.png" bindtap="preview" />');
    const missingResources = runCheck(root);
    assert.equal(missingResources.status, 1);
    assert.match(missingResources.output, /missing asset/);
    assert.match(missingResources.output, /missing handler preview/);

    mkdirSync(join(mini, 'guide', 'assets'));
    writeFileSync(join(mini, 'guide', 'assets', 'rules.png'), 'fixture');
    writeFileSync(join(guidePages, 'rules', 'rules.ts'), 'preview() {}');
    const valid = runCheck(root);
    assert.equal(valid.status, 0, valid.output);
    assert.match(valid.output, /11 registered pages/);

    writeFileSync(join(pages, 'index', 'index.ts'),
      "const route = '/guide/pages/missing/missing';");
    const missingRoute = runCheck(root);
    assert.equal(missingRoute.status, 1);
    assert.match(missingRoute.output, /unregistered navigation route/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
