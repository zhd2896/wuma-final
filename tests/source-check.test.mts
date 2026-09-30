import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const expectedPages = ['index', 'game', 'analysis', 'review', 'coach',
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
