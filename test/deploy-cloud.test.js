import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

async function read(rel) {
  return fs.readFile(path.join(root, rel), 'utf8');
}

test('gcloud ignore keeps upload small and leaves the runtime tree', async () => {
  const ignore = await read('.gcloudignore');
  for (const pattern of ['node_modules', 'uploads', 'data', '.git', 'test', 'docs']) {
    assert.match(ignore, new RegExp('^' + pattern + '$', 'm'), pattern + ' must stay off the Cloud Build upload');
  }
  assert.doesNotMatch(ignore, /^public$/m);
  assert.doesNotMatch(ignore, /^lib$/m);
  assert.doesNotMatch(ignore, /^Dockerfile$/m);
});

test('docker image copies lockfile before app sources', async () => {
  const docker = await read('Dockerfile');
  const lockAt = docker.indexOf('COPY package*.json');
  const npmAt = docker.indexOf('npm ci --omit=dev');
  const appAt = docker.indexOf('COPY . .');
  assert.ok(lockAt >= 0 && npmAt > lockAt && appAt > npmAt, 'npm ci must stay cached when only app files change');
});

test('deploy script skips IAM on incremental updates and uses Kaniko cache', async () => {
  const script = await read('deploy/deploy-cloud.ps1');
  const build = await read('deploy/cloudbuild.yaml');
  assert.match(script, /\$doBootstrap = \[bool\]\$Bootstrap -or -not \$serviceExists/);
  assert.match(script, /Incremental deploy: cached image build/);
  assert.match(script, /builds submit/);
  assert.match(script, /cloudbuild\.yaml/);
  assert.match(build, /kaniko-project\/executor/);
  assert.match(build, /--cache=true/);
});
