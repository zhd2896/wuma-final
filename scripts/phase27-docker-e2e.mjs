/** Isolated Compose acceptance run. Containers stop afterward; the named volume remains. */
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { requestApi, runApiSmoke } from './phase27-api-smoke.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = `wuma-phase27-${randomBytes(4).toString('hex')}`;
const port = 18080 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  BACKEND_IMAGE: `wuma-backend:${project}`,
  DB_NAME: 'wuma',
  DB_USER: 'wuma',
  DB_PASSWORD: randomBytes(24).toString('hex'),
  DB_ROOT_PASSWORD: randomBytes(24).toString('hex'),
  DATABASE_URL: '',
  LLM_API_KEY: '',
  LLM_BASE_URL: '',
  LLM_MODEL: '',
  NGINX_BIND_ADDRESS: '127.0.0.1',
  HTTP_PORT: String(port),
  HTTPS_PORT: String(port + 1000),
  NGINX_CONFIG: './deploy/nginx/conf.d/local.conf',
  TLS_CERT_DIR: './deploy/nginx/empty-certs',
};
const composeArgs = ['compose', '-f', resolve(root, 'compose.yml'), '-p', project];

function compose(args, { quiet = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', [...composeArgs, ...args], {
      cwd: root, env, stdio: quiet ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    let output = '';
    if (quiet) child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0
      ? resolvePromise(output.trim())
      : reject(new Error(`docker compose ${args.join(' ')} exited ${code}`)));
  });
}

async function waitReady() {
  let lastError;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const ready = await requestApi(baseUrl, 'GET', '/ready');
      if (ready.engine === 'ok') return;
    } catch (error) { lastError = error; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 2000));
  }
  throw new Error(`Nginx readiness timeout: ${lastError?.message ?? 'unknown'}`);
}

async function verifySaved(result) {
  await waitReady();
  const game = await requestApi(baseUrl, 'GET', `/api/v1/game/${result.gameId}`);
  if (game.version !== result.gameVersion) throw new Error('Game version changed during restart');
  const review = await requestApi(baseUrl, 'GET',
    `/api/v1/game/${result.finishedGameId}/review`);
  if (review.id !== result.reviewId) throw new Error('Review missing after restart');
  const training = await requestApi(baseUrl, 'GET',
    `/api/v1/training/${result.trainingId}`);
  if (training.id !== result.trainingId) throw new Error('Training missing after restart');
}

async function verifyMigration() {
  const current = await compose(['exec', '-T', 'backend', 'alembic', '-c',
    '/app/backend/alembic.ini', 'current'], { quiet: true });
  const heads = await compose(['exec', '-T', 'backend', 'alembic', '-c',
    '/app/backend/alembic.ini', 'heads'], { quiet: true });
  const revision = heads.match(/^([A-Za-z0-9_]+)\s+\(head\)/m)?.[1];
  if (!revision || !current.includes(revision)) {
    throw new Error(`Migration is not at head: current=${current}, heads=${heads}`);
  }
  const check = await compose(['exec', '-T', 'backend', 'alembic', '-c',
    '/app/backend/alembic.ini', 'check'], { quiet: true });
  if (!check.includes('No new upgrade operations detected')) {
    throw new Error(`Alembic schema check failed: ${check}`);
  }
  return revision;
}

async function verifyRuntime() {
  const python = await compose(['exec', '-T', 'backend', 'python', '--version'], { quiet: true });
  const node = await compose(['exec', '-T', 'backend', 'node', '--version'], { quiet: true });
  const userId = await compose(['exec', '-T', 'backend', 'id', '-u'], { quiet: true });
  if (!python.startsWith('Python 3.12.') || !node.startsWith('v24.') || userId !== '10001') {
    throw new Error(`Unexpected runtime: ${python}, ${node}, uid=${userId}`);
  }
  return { python, node, userId };
}

if (spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  cwd: root, stdio: 'ignore', timeout: 10_000,
}).status !== 0) {
  console.error('NOT_RUN: Docker CLI and a reachable Docker daemon are required.');
  process.exit(2);
}

let started = false;
try {
  await compose(['config', '--quiet']);
  await compose(['build', '--no-cache', 'backend']);
  started = true;
  await compose(['up', '--build', '--detach', '--wait']);
  await waitReady();
  const runtime = await verifyRuntime();
  const firstMigration = await verifyMigration();
  const result = await runApiSmoke(baseUrl);
  await compose(['restart', 'backend']);
  await verifySaved(result);
  await compose(['restart', 'mysql']);
  await verifySaved(result);
  await compose(['down']);
  await compose(['up', '--build', '--detach', '--wait']);
  await verifySaved(result);
  const secondMigration = await verifyMigration();
  if (firstMigration !== secondMigration) throw new Error('Migration revision changed');
  await compose(['build', 'backend']);
  await compose(['up', '--build', '--detach', '--wait']);
  await verifySaved(result);
  const image = spawnSync('docker', ['image', 'inspect', env.BACKEND_IMAGE,
    '--format', '{{.Size}}'], { cwd: root, env, encoding: 'utf8' });
  if (image.status !== 0 || !/^\d+$/.test(image.stdout.trim())) {
    throw new Error('Could not inspect backend image size');
  }
  await compose(['logs', '--no-color', '--tail', '80', 'backend', 'nginx', 'mysql']);
  console.log(JSON.stringify({ ...result, project, migration: secondMigration,
    runtime, backendImageBytes: Number(image.stdout.trim()),
    checks: ['clean-build', 'repeat-build', 'api-smoke', 'backend-restart',
      'mysql-restart', 'compose-recreate', 'migration-idempotence', 'volume-persistence'],
    volumePreserved: `${project}_mysql_data`,
  }, null, 2));
} catch (error) {
  console.error(error);
  if (started) {
    try { await compose(['logs', '--no-color', '--tail', '100']); } catch { /* preserve original error */ }
  }
  process.exitCode = 1;
} finally {
  if (started) {
    try { await compose(['down']); } catch (error) { console.error(error); process.exitCode = 1; }
  }
}
