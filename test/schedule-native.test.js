import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';

import { rejectScheduleContentType } from '../lib/schedule-policy.js';
import {
  cancelFacebookTarget,
  rescheduleFacebookTarget,
  scheduleFacebookTarget,
} from '../lib/native-schedule.js';
import { createScheduleRouter } from '../lib/routes/schedule.js';
import { getPublishingPlatforms } from '../lib/platforms.js';
import { jsonFiles, readJson, writeJson } from '../lib/store.js';

test('rejects Facebook story scheduling', () => {
  assert.match(rejectScheduleContentType('facebook', 'story'), /Story|限時動態/);
  assert.equal(rejectScheduleContentType('facebook', 'post'), null);
});

test('publishes Facebook target immediately with scheduledAt', async () => {
  const calls = [];
  const publisher = {
    configured: true,
    async publish(post, options) {
      calls.push({ post, options });
      return { externalId: 'scheduled-post-1' };
    },
  };

  const result = await scheduleFacebookTarget({
    publisher,
    post: { facebook: '母稿', reel: 'Reel 文案', hashtags: ['#測試'] },
    target: {
      platformId: 'facebook',
      contentType: 'reel',
      copyOverride: '目標文案',
      contentSettings: { placement: 'feed' },
    },
    scheduledAt: '2026-08-14T10:00:00.000Z',
    mediaFilePaths: ['D:/uploads/video.mp4'],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].post.reel, '目標文案');
  assert.equal(calls[0].options.contentType, 'reel');
  assert.equal(calls[0].options.scheduledAt, '2026-08-14T10:00:00.000Z');
  assert.deepEqual(calls[0].options.mediaFilePaths, ['D:/uploads/video.mp4']);
  assert.deepEqual(result, {
    scheduledAt: '2026-08-14T10:00:00.000Z',
    status: 'scheduled',
    externalId: 'scheduled-post-1',
    lastError: null,
  });
});

test('does not schedule with an unconfigured Facebook publisher', async () => {
  await assert.rejects(
    () => scheduleFacebookTarget({
      publisher: { configured: false },
      post: { facebook: '測試' },
      target: { platformId: 'facebook', contentType: 'post' },
      scheduledAt: '2026-08-14T10:00:00.000Z',
      mediaFilePaths: [],
    }),
    /Facebook/,
  );
});

test('reschedule deletes old external id then schedules again', async () => {
  const calls = [];
  const publisher = {
    configured: true,
    async deleteScheduled(id) {
      calls.push(['delete', id]);
      return { deleted: true, externalId: id };
    },
    async publish() {
      calls.push(['publish']);
      return { externalId: 'new-id', scheduled: true };
    },
  };
  const next = await rescheduleFacebookTarget({
    publisher,
    post: { facebook: 'x', reel: '', hashtags: [] },
    target: { contentType: 'post', contentSettings: {}, externalId: 'old-id' },
    scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    mediaFilePaths: [],
  });
  assert.deepEqual(calls.map((call) => call[0]), ['delete', 'publish']);
  assert.equal(next.externalId, 'new-id');
});

test('cancel clears local schedule after deleteScheduled', async () => {
  const publisher = {
    async deleteScheduled(id) {
      return { deleted: true, externalId: id };
    },
  };
  const next = await cancelFacebookTarget({
    publisher,
    target: { externalId: 'old-id', status: 'scheduled', scheduledAt: '2026-08-14T00:00:00.000Z' },
  });
  assert.equal(next.status, 'draft');
  assert.equal(next.scheduledAt, null);
  assert.equal(next.externalId, null);
});

test('POST /schedule calls Facebook before persisting scheduled target', async () => {
  const originalPosts = await fs.readFile(jsonFiles.posts, 'utf8').catch(() => '[]');
  const originalClients = await fs.readFile(jsonFiles.clients, 'utf8').catch(() => '[]');
  let publishCalls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => ({
      configured: true,
      async publish() {
        publishCalls += 1;
        return { externalId: 'graph-1' };
      },
    }),
  }));
  const server = app.listen(0);

  try {
    await writeJson(jsonFiles.clients, [{
      id: 'client-1',
      accounts: [{ id: 'facebook:1', platformId: 'facebook', configured: true }],
    }]);
    await writeJson(jsonFiles.posts, [{
      id: 'post-1',
      clientId: 'client-1',
      facebook: '原生排程測試',
      targets: [],
    }]);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId: 'post-1',
        accountId: 'facebook:1',
        channel: 'facebook',
        contentType: 'post',
        scheduledAt: '2026-08-14T10:00:00.000Z',
      }),
    });
    assert.equal(response.status, 201);
    assert.equal(publishCalls, 1);
    const item = await response.json();
    assert.equal(item.status, 'scheduled');
    const posts = await readJson(jsonFiles.posts, []);
    assert.equal(posts[0].targets[0].status, 'scheduled');
    assert.equal(posts[0].targets[0].externalId, 'graph-1');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.writeFile(jsonFiles.posts, originalPosts, 'utf8');
    await fs.writeFile(jsonFiles.clients, originalClients, 'utf8');
  }
});

test('POST /schedule reschedules when target already has externalId', async () => {
  const originalPosts = await fs.readFile(jsonFiles.posts, 'utf8').catch(() => '[]');
  const originalClients = await fs.readFile(jsonFiles.clients, 'utf8').catch(() => '[]');
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => ({
      configured: true,
      async deleteScheduled(id) {
        calls.push(['delete', id]);
        return { deleted: true, externalId: id };
      },
      async publish() {
        calls.push(['publish']);
        return { externalId: 'graph-new' };
      },
    }),
  }));
  const server = app.listen(0);

  try {
    await writeJson(jsonFiles.clients, [{
      id: 'client-1',
      accounts: [{ id: 'facebook:1', platformId: 'facebook', configured: true }],
    }]);
    await writeJson(jsonFiles.posts, [{
      id: 'post-1',
      clientId: 'client-1',
      facebook: '重排程測試',
      targets: [{
        id: 'target-1',
        accountId: 'facebook:1',
        platformId: 'facebook',
        contentType: 'post',
        status: 'scheduled',
        scheduledAt: '2026-08-14T10:00:00.000Z',
        externalId: 'graph-old',
      }],
    }]);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId: 'post-1',
        targetId: 'target-1',
        channel: 'facebook',
        accountId: 'facebook:1',
        contentType: 'post',
        scheduledAt: '2026-08-15T10:00:00.000Z',
      }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(calls, [['delete', 'graph-old'], ['publish']]);
    const item = await response.json();
    assert.equal(item.externalId, 'graph-new');
    assert.equal((await readJson(jsonFiles.posts, []))[0].targets[0].externalId, 'graph-new');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.writeFile(jsonFiles.posts, originalPosts, 'utf8');
    await fs.writeFile(jsonFiles.clients, originalClients, 'utf8');
  }
});

test('POST /schedule rejects targetId when platform or contentType mismatch', async () => {
  const originalPosts = await fs.readFile(jsonFiles.posts, 'utf8').catch(() => '[]');
  const originalClients = await fs.readFile(jsonFiles.clients, 'utf8').catch(() => '[]');
  let publishCalls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => ({
      configured: true,
      async publish() {
        publishCalls += 1;
        return { externalId: 'unexpected' };
      },
    }),
  }));
  const server = app.listen(0);

  try {
    await writeJson(jsonFiles.clients, [{
      id: 'client-1',
      accounts: [{ id: 'facebook:1', platformId: 'facebook', configured: true }],
    }]);
    await writeJson(jsonFiles.posts, [{
      id: 'post-1',
      clientId: 'client-1',
      facebook: '跨平台 target 測試',
      targets: [{
        id: 'target-instagram',
        accountId: 'instagram:1',
        platformId: 'instagram',
        contentType: 'feed',
        status: 'draft',
      }],
    }]);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId: 'post-1',
        targetId: 'target-instagram',
        channel: 'facebook',
        accountId: 'facebook:1',
        contentType: 'post',
        scheduledAt: '2026-08-14T10:00:00.000Z',
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(publishCalls, 0);
    assert.match((await response.json()).error, /排程目標與指定平台／格式不符/);
    const posts = await readJson(jsonFiles.posts, []);
    assert.equal(posts[0].targets[0].status, 'draft');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.writeFile(jsonFiles.posts, originalPosts, 'utf8');
    await fs.writeFile(jsonFiles.clients, originalClients, 'utf8');
  }
});

test('POST /schedule rejects Facebook story before publisher call', async () => {
  let publishCalls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => ({
      configured: true,
      async publish() {
        publishCalls += 1;
        return { externalId: 'unexpected' };
      },
    }),
  }));
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId: 'missing-is-irrelevant',
        channel: 'facebook',
        contentType: 'story',
        scheduledAt: '2026-08-14T10:00:00.000Z',
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(publishCalls, 0);
    assert.match((await response.json()).error, /Story|限時動態/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PATCH and DELETE /schedule/:targetId synchronize Facebook and local target', async () => {
  const originalPosts = await fs.readFile(jsonFiles.posts, 'utf8').catch(() => '[]');
  const originalClients = await fs.readFile(jsonFiles.clients, 'utf8').catch(() => '[]');
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => ({
      configured: true,
      async deleteScheduled(id) {
        calls.push(['delete', id]);
        return { deleted: true, externalId: id };
      },
      async publish() {
        calls.push(['publish']);
        return { externalId: 'graph-new' };
      },
    }),
  }));
  const server = app.listen(0);
  try {
    await writeJson(jsonFiles.clients, [{ id: 'client-1', accounts: [{ id: 'facebook:1', platformId: 'facebook' }] }]);
    await writeJson(jsonFiles.posts, [{
      id: 'post-1',
      clientId: 'client-1',
      facebook: '修改時間',
      targets: [{
        id: 'target-1',
        accountId: 'facebook:1',
        platformId: 'facebook',
        contentType: 'post',
        status: 'scheduled',
        scheduledAt: '2026-08-14T10:00:00.000Z',
        externalId: 'graph-old',
      }],
    }]);
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/schedule/target-1`;
    const patchResponse = await fetch(baseUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt: '2026-08-15T10:00:00.000Z' }),
    });
    assert.equal(patchResponse.status, 200);
    assert.deepEqual(calls, [['delete', 'graph-old'], ['publish']]);
    assert.equal((await readJson(jsonFiles.posts, []))[0].targets[0].externalId, 'graph-new');

    const deleteResponse = await fetch(baseUrl, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(calls, [['delete', 'graph-old'], ['publish'], ['delete', 'graph-new']]);
    const target = (await readJson(jsonFiles.posts, []))[0].targets[0];
    assert.equal(target.status, 'draft');
    assert.equal(target.scheduledAt, null);
    assert.equal(target.externalId, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.writeFile(jsonFiles.posts, originalPosts, 'utf8');
    await fs.writeFile(jsonFiles.clients, originalClients, 'utf8');
  }
});

test('PATCH marks target failed when Facebook delete succeeds but create fails', async () => {
  const originalPosts = await fs.readFile(jsonFiles.posts, 'utf8').catch(() => '[]');
  const originalClients = await fs.readFile(jsonFiles.clients, 'utf8').catch(() => '[]');
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => ({
      configured: true,
      async deleteScheduled() {
        return { deleted: true };
      },
      async publish() {
        throw new Error('建立新 Facebook 排程失敗');
      },
    }),
  }));
  const server = app.listen(0);
  try {
    await writeJson(jsonFiles.clients, [{ id: 'client-1', accounts: [{ id: 'facebook:1', platformId: 'facebook' }] }]);
    await writeJson(jsonFiles.posts, [{
      id: 'post-1',
      clientId: 'client-1',
      facebook: '失敗案例',
      targets: [{
        id: 'target-1',
        accountId: 'facebook:1',
        platformId: 'facebook',
        contentType: 'post',
        status: 'scheduled',
        scheduledAt: '2026-08-14T10:00:00.000Z',
        externalId: 'graph-old',
      }],
    }]);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/schedule/target-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt: '2026-08-15T10:00:00.000Z' }),
    });
    assert.equal(response.status, 502);
    const target = (await readJson(jsonFiles.posts, []))[0].targets[0];
    assert.equal(target.status, 'failed');
    assert.equal(target.externalId, null);
    assert.equal(target.lastError.message, '建立新 Facebook 排程失敗');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.writeFile(jsonFiles.posts, originalPosts, 'utf8');
    await fs.writeFile(jsonFiles.clients, originalClients, 'utf8');
  }
});
