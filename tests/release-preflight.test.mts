import { API_BASE_URLS } from '../miniprogram/config/api-roots.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('release preflight rejects unset deployments, invalid roots and placeholders without leaking credentials', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ['scripts/check-release.mjs', ...args], { encoding: 'utf8' });
  for (const target of ['trial', 'release']) assert.notEqual(run(target).status, 0);
  for (const root of ['', 'http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://10.0.0.1',
    'https://172.16.0.1', 'https://192.168.0.1', 'https://[::1]', 'https://example.com?q=1',
    'https://example.com/#x', 'https://user:PRIVATE@example.com', 'https://example.com\\evil', 'https://example.com/%2e%2e',
    'https://0x7f.0x0.0x0.0x1', 'https://0xc0.0xa8.0x1.0x1']) {
    const result = run('trial', '--api-root', root); assert.notEqual(result.status, 0, root);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE/);
  }
  assert.notEqual(run('unknown').status, 0);
  assert.notEqual(run('release', '--api-root', 'https://api.example.com/wuma', '--appid', 'wx0000000000000000').status, 0);
  const valid = run('release', '--api-root', 'https://api.example.com/wuma');
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  assert.match(valid.stdout, /格式|format/);
  assert.equal(run('development').status, 0);
});

test('public configuration build writes only target root with its prefix and rejects invalid input without mutation', () => {
  const temp = mkdtempSync(join(tmpdir(), 'wuma-public-config-'));
  try {
    mkdirSync(join(temp, 'scripts')); mkdirSync(join(temp, 'miniprogram/config'), { recursive: true });
    for (const file of ['scripts/check-release.mjs', 'scripts/configure-release.mjs',
      'miniprogram/config/api-root.ts', 'miniprogram/config/api-roots.ts', 'project.config.json']) {
      copyFileSync(new URL('../' + file, import.meta.url), join(temp, file));
    }
    const project = readFileSync(join(temp, 'project.config.json'), 'utf8');
    const script = join(temp, 'scripts/configure-release.mjs');
    const valid = spawnSync(process.execPath, [script, 'trial', '--api-root', 'https://api.example.com/wuma/'], { encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
    const config = readFileSync(join(temp, 'miniprogram/config/api-roots.ts'), 'utf8');
    assert.match(config, /"test": "https:\/\/api.example.com\/wuma"/);
    assert.match(config, /"production": ""/); assert.ok(config.includes(JSON.stringify(API_BASE_URLS.development)));
    assert.equal(readFileSync(join(temp, 'project.config.json'), 'utf8'), project);
    const invalid = spawnSync(process.execPath, [script, 'release', '--api-root', 'https://user:PRIVATE@example.com'], { encoding: 'utf8' });
    assert.notEqual(invalid.status, 0); assert.doesNotMatch(invalid.stdout + invalid.stderr, /PRIVATE/);
    assert.equal(readFileSync(join(temp, 'miniprogram/config/api-roots.ts'), 'utf8'), config);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
