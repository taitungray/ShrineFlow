import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import { createCrisisPauseRouter } from '../lib/routes/crisis-pause.js';

function repository(initial = []) {
  const records = initial.map((record) => structuredClone(record));
  return {
    async list() { return structuredClone(records); },
    async getById(id) { return records.find((record) => record.id === id) || null; },
    async mutate(mutator) { return mutator(records); },
  };
}

function setup({ deleteFails = false } = {}) {
  const repositories = {
    clients: repository([{
      id: 'client-pause',
      accounts: [{ id: 'facebook:pause', platformId: 'facebook', configured: true }],
    }]),
    posts: repository([{
      id: 'post-pause',
      clientId: 'client-pause',
      facebook: '危機暫停測試',
      targets: [{
        id: 'target-pause',
        accountId: 'facebook:pause',
        platformId: 'facebook',
        contentType: 'post',
        scheduleSource: 'facebook_native',
        scheduleMode: 'manual',
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        externalId: 'remote-old',
      }],
    }]),
  };
  const calls = [];
  const publisher = {
    configured: true,
    async deleteScheduled(id) {
      calls.push(['delete', id]);
      if (deleteFails) throw new Error('遠端取消失敗');
      return { externalId: id };
    },
    async publish(_post, options) {
      calls.push(['publish', options.scheduledAt]);
      return { externalId: 'remote-new' };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createCrisisPauseRouter({
    repositories,
    getClient: async (clientId) => repositories.clients.getById(clientId),
    resolveFacebookPublisher: async () => publisher,
  }));
  return { app, repositories, calls };
}

test('crisis pause cancels Facebook remote schedule and resume creates a new external ID', async () => {
  const { app, repositories, calls } = setup();
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/crisis-pause`;
    const paused = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-pause', reason: '重大事件' }),
    });
    assert.equal(paused.status, 200);
    assert.equal((await paused.json()).results[0].status, 'paused');
    assert.deepEqual(calls, [['delete', 'remote-old']]);
    const pausedPost = await repositories.posts.getById('post-pause');
    assert.equal(pausedPost.targets[0].pauseState, 'paused');
    assert.equal(pausedPost.targets[0].externalId, null);

    const resumed = await fetch(`${base}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-pause' }),
    });
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).status, 'active');
    assert.deepEqual(calls.map((call) => call[0]), ['delete', 'publish']);
    const resumedPost = await repositories.posts.getById('post-pause');
    assert.equal(resumedPost.targets[0].pauseState, 'none');
    assert.equal(resumedPost.targets[0].externalId, 'remote-new');
    assert.equal((await repositories.clients.getById('client-pause')).crisisPause, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('remote cancel failure remains explicitly unsafe to resume', async () => {
  const { app, repositories } = setup({ deleteFails: true });
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/crisis-pause`;
    const paused = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-pause' }),
    });
    assert.equal(paused.status, 200);
    const pausePayload = await paused.json();
    assert.equal(pausePayload.results[0].status, 'remote_cancel_failed');
    assert.equal((await repositories.posts.getById('post-pause')).targets[0].externalId, 'remote-old');

    const resumed = await fetch(`${base}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-pause' }),
    });
    assert.equal(resumed.status, 409);
    assert.equal((await resumed.json()).status, 'paused');
    assert.equal((await repositories.posts.getById('post-pause')).targets[0].pauseState, 'remote_cancel_failed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
