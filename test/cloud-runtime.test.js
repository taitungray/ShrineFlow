import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

import { createLocalJsonRepository } from '../lib/repositories.js';
import { createLocalMediaStorage } from '../lib/media-storage.js';
import { createScheduler } from '../lib/scheduler.js';
import { createSchedulerTriggerRouter } from '../lib/routes/internal-scheduler.js';

test('local repository keeps the existing JSON collection shape', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-repository-'));
  const filePath = path.join(directory, 'posts.json');
  const repository = createLocalJsonRepository({ name: 'posts', filePath, fallback: [] });

  assert.deepEqual(await repository.list(), []);
  await repository.mutate((posts) => posts.push({ id: 'post-1', status: 'draft' }));
  assert.deepEqual(await repository.getById('post-1'), { id: 'post-1', status: 'draft' });
  assert.equal(repository.backend, 'local-json');
  assert.equal(repository.schemaVersion, 1);
});

async function startTrigger(options) {
  const app = express();
  app.use('/api', createSchedulerTriggerRouter(options));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return server;
}

test('scheduler trigger rejects an invalid shared token and runs one valid tick', async () => {
  let calls = 0;
  const server = await startTrigger({
    env: { NODE_ENV: 'production', SHRINEFLOW_SCHEDULER_TOKEN: 'scheduler-secret' },
    processDueSchedules: async () => {
      calls += 1;
      return { processed: 2, skipped: false };
    },
  });
  const base = `http://127.0.0.1:${server.address().port}/api/internal/scheduler/tick`;

  try {
    const unauthorized = await fetch(base, { method: 'POST' });
    assert.equal(unauthorized.status, 401);
    const authorized = await fetch(base, {
      method: 'POST',
      headers: { 'X-ShrineFlow-Scheduler-Token': 'scheduler-secret' },
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), { ok: true, processed: 2, skipped: false });
    assert.equal(calls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('scheduler trigger can trust Cloud Run IAM after platform authentication', async () => {
  let called = false;
  const server = await startTrigger({
    env: { NODE_ENV: 'production', SHRINEFLOW_SCHEDULER_ALLOW_PLATFORM_AUTH: 'true' },
    processDueSchedules: async () => {
      called = true;
      return { processed: 0, skipped: false };
    },
  });
  const url = `http://127.0.0.1:${server.address().port}/api/internal/scheduler/tick`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer cloud-run-oidc-token' },
    });
    assert.equal(response.status, 200);
    assert.equal(called, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('production scheduler trigger refuses to run without app or platform auth', async () => {
  const server = await startTrigger({
    env: { NODE_ENV: 'production' },
    processDueSchedules: async () => ({ processed: 0 }),
  });
  const url = `http://127.0.0.1:${server.address().port}/api/internal/scheduler/tick`;

  try {
    const response = await fetch(url, { method: 'POST' });
    assert.equal(response.status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('local media storage resolves web paths without exposing traversal', () => {
  const storage = createLocalMediaStorage({ uploadsDirectory: 'D:/media' });
  assert.equal(storage.resolveWebPath('photo.jpg'), '/uploads/photo.jpg');
  assert.equal(storage.resolveFilePath('/uploads/photo.jpg'), path.join('D:/media', 'photo.jpg'));
  assert.equal(storage.resolveFilePath('../photo.jpg'), null);
  assert.equal(storage.resolvePublicUrl('/uploads/photo.jpg', 'https://media.example/'), 'https://media.example/uploads/photo.jpg');
});

test('production scheduler mode has no local timer', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousMode = process.env.SHRINEFLOW_SCHEDULER_MODE;
  process.env.NODE_ENV = 'production';
  delete process.env.SHRINEFLOW_SCHEDULER_MODE;
  try {
    const scheduler = createScheduler({
      repositories: { posts: { mutate: async () => null, list: async () => [] } },
    });
    assert.equal(scheduler.mode, 'cloud');
    assert.equal(scheduler.startTimer(), null);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousMode === undefined) delete process.env.SHRINEFLOW_SCHEDULER_MODE;
    else process.env.SHRINEFLOW_SCHEDULER_MODE = previousMode;
  }
});
