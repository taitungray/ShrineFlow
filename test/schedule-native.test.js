import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import {
  assertLocalScheduleWindow,
  rejectLocalScheduleTooSoon,
  rejectScheduleContentType,
  resolveScheduleTime,
  resolveZonedDateTime,
} from '../lib/schedule-policy.js';
import {
  cancelFacebookTarget,
  rescheduleFacebookTarget,
  scheduleFacebookTarget,
} from '../lib/native-schedule.js';
import { createScheduleRouter } from '../lib/routes/schedule.js';
import { getPublishingPlatforms } from '../lib/platforms.js';
import { jsonFiles, readJson, writeJson } from '../lib/store.js';

const originalJsonFiles = { ...jsonFiles };
let temporaryDataDirectory;

before(async () => {
  temporaryDataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-schedule-native-'));
  Object.assign(jsonFiles, {
    posts: path.join(temporaryDataDirectory, 'posts.json'),
    schedule: path.join(temporaryDataDirectory, 'schedule.json'),
    clients: path.join(temporaryDataDirectory, 'clients.json'),
    errorLog: path.join(temporaryDataDirectory, 'error-log.json'),
  });
  await Promise.all([
    writeJson(jsonFiles.posts, []),
    writeJson(jsonFiles.schedule, []),
    writeJson(jsonFiles.clients, []),
    writeJson(jsonFiles.errorLog, { version: 1, items: [] }),
  ]);
});

after(async () => {
  Object.assign(jsonFiles, originalJsonFiles);
  await fs.rm(temporaryDataDirectory, { recursive: true, force: true });
});

test('rejects Facebook story scheduling', () => {
  assert.match(rejectScheduleContentType('facebook', 'story'), /Story|限時動態/);
  assert.equal(rejectScheduleContentType('facebook', 'post'), null);
});

test('local schedules require at least a one minute buffer', () => {
  const now = new Date('2026-08-13T08:00:00.000Z');
  assert.match(
    rejectLocalScheduleTooSoon('2026-08-13T08:00:59.999Z', now),
    /至少是 1 分鐘後/,
  );
  assert.equal(rejectLocalScheduleTooSoon('2026-08-13T08:01:00.000Z', now), null);
  assert.equal(
    assertLocalScheduleWindow('2026-08-13T08:01:00.000Z', now).toISOString(),
    '2026-08-13T08:01:00.000Z',
  );
  assert.throws(
    () => assertLocalScheduleWindow('not-a-date', now),
    /格式不正確/,
  );
});

test('resolves schedule local time with an explicit IANA timezone', () => {
  const taipei = resolveScheduleTime({
    scheduledLocal: '2026-08-14T10:00',
    timeZone: 'Asia/Taipei',
  });
  assert.equal(taipei.ok, true);
  assert.equal(taipei.scheduledAt, '2026-08-14T02:00:00.000Z');

  const legacyIso = resolveScheduleTime({ scheduledAt: '2026-08-14T02:00:00.000Z', timeZone: 'Asia/Taipei' });
  assert.equal(legacyIso.ok, true);
  assert.equal(legacyIso.scheduledAt, '2026-08-14T02:00:00.000Z');
});

test('rejects nonexistent and ambiguous daylight-saving local times', () => {
  const nonexistent = resolveZonedDateTime('2026-03-08T02:30', 'America/New_York');
  assert.equal(nonexistent.ok, false);
  assert.equal(nonexistent.code, 'SCHEDULE_DST_NONEXISTENT');

  const ambiguous = resolveZonedDateTime('2026-11-01T01:30', 'America/New_York');
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.code, 'SCHEDULE_DST_AMBIGUOUS');

  const invalidZone = resolveScheduleTime({
    scheduledLocal: '2026-08-14T10:00',
    timeZone: 'Not/AZone',
  });
  assert.equal(invalidZone.ok, false);
  assert.equal(invalidZone.code, 'SCHEDULE_TIMEZONE_INVALID');
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

test('cancel treats already-deleted Facebook objects as success', async () => {
  const publisher = {
    configured: true,
    async deleteScheduled() {
      const error = new Error("Unsupported post request. Object with ID 'old-id' does not exist");
      error.code = 100;
      error.subcode = 33;
      throw error;
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

test('cancel still fails when Facebook token is expired', async () => {
  const publisher = {
    configured: true,
    async deleteScheduled() {
      const error = new Error('Facebook Token 已過期。');
      error.code = 190;
      throw error;
    },
  };
  await assert.rejects(
    () => cancelFacebookTarget({
      publisher,
      target: { externalId: 'old-id', status: 'scheduled', scheduledAt: '2026-08-14T00:00:00.000Z' },
    }),
    /Token 已過期/,
  );
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
  }
});

test('POST /schedule concurrent requests only call Facebook once', async () => {
  let publishCalls = 0;
  let releasePublish;
  const publishGate = new Promise((resolve) => {
    releasePublish = resolve;
  });
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => ({
      configured: true,
      async publish() {
        publishCalls += 1;
        await publishGate;
        return { externalId: 'graph-once' };
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
      id: 'post-dup',
      clientId: 'client-1',
      facebook: '連點防重',
      targets: [{
        id: 'target-dup',
        accountId: 'facebook:1',
        platformId: 'facebook',
        contentType: 'post',
        status: 'draft',
      }],
    }]);
    const url = `http://127.0.0.1:${server.address().port}/api/schedule`;
    const payload = {
      postId: 'post-dup',
      targetId: 'target-dup',
      accountId: 'facebook:1',
      channel: 'facebook',
      contentType: 'post',
      scheduledAt: '2026-08-17T00:00:00.000Z',
    };
    const first = fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const second = fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      assert.equal(publishCalls, 1);
    } finally {
      releasePublish();
    }
    const responses = await Promise.all([first, second]);
    const statuses = responses.map((response) => response.status).sort();
    assert.deepEqual(statuses, [201, 409]);
    const posts = await readJson(jsonFiles.posts, []);
    assert.equal(posts[0].targets[0].status, 'scheduled');
    assert.equal(posts[0].targets[0].externalId, 'graph-once');
    assert.equal(publishCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /schedule rejects a second schedule after success without calling Facebook again', async () => {
  let publishCalls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => ({
      configured: true,
      async publish() {
        publishCalls += 1;
        return { externalId: `graph-${publishCalls}` };
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
      id: 'post-again',
      clientId: 'client-1',
      facebook: '已排程不可再排',
      targets: [{
        id: 'target-again',
        accountId: 'facebook:1',
        platformId: 'facebook',
        contentType: 'post',
        status: 'draft',
      }],
    }]);
    const url = `http://127.0.0.1:${server.address().port}/api/schedule`;
    const payload = {
      postId: 'post-again',
      targetId: 'target-again',
      accountId: 'facebook:1',
      channel: 'facebook',
      contentType: 'post',
      scheduledAt: '2026-08-17T01:00:00.000Z',
    };
    const first = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const second = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 409);
    assert.equal(publishCalls, 1);
    const body = await second.json();
    assert.match(body.error, /已排程|發布中/);
    const posts = await readJson(jsonFiles.posts, []);
    assert.equal(posts[0].targets[0].externalId, 'graph-1');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /schedule replays the same idempotency key without a second Facebook publish', async () => {
  let publishCalls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => ({
      configured: true,
      async publish() {
        publishCalls += 1;
        return { externalId: 'graph-idempotent' };
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
      id: 'post-key',
      clientId: 'client-1',
      facebook: '冪等排程',
      targets: [{
        id: 'target-key',
        accountId: 'facebook:1',
        platformId: 'facebook',
        contentType: 'post',
        status: 'draft',
      }],
    }]);
    const url = `http://127.0.0.1:${server.address().port}/api/schedule`;
    const payload = {
      postId: 'post-key',
      targetId: 'target-key',
      accountId: 'facebook:1',
      channel: 'facebook',
      contentType: 'post',
      scheduledAt: '2026-08-17T02:00:00.000Z',
    };
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'sched-key-1' };
    const first = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const second = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal((await second.json()).replayed, true);
    assert.equal(publishCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /schedule compensates remote success when local version changes before persistence', async () => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => ({
      configured: true,
      async publish() {
        calls.push('publish');
        const currentPosts = await readJson(jsonFiles.posts, []);
        await writeJson(jsonFiles.posts, currentPosts.map((post) => ({
          ...post,
          version: Number(post.version || 1) + 1,
        })));
        return { externalId: 'graph-orphan' };
      },
      async deleteScheduled(id) {
        calls.push(['delete', id]);
        return { deleted: true, externalId: id };
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
      id: 'post-version-race',
      version: 1,
      clientId: 'client-1',
      facebook: 'Schedule version race',
      targets: [],
    }]);

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId: 'post-version-race',
        accountId: 'facebook:1',
        channel: 'facebook',
        contentType: 'post',
        scheduledAt: '2026-08-15T10:00:00.000Z',
      }),
    });

    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, 'SCHEDULE_LOCAL_SYNC_FAILED');
    assert.deepEqual(calls, ['publish', ['delete', 'graph-orphan']]);
    const posts = await readJson(jsonFiles.posts, []);
    const target = posts[0].targets[0];
    assert.ok(target);
    assert.notEqual(target.status, 'scheduled');
    assert.equal(target.externalId || null, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /schedule resolves local time and persists the selected timezone', async () => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => ({
      configured: true,
      async publish(_post, options) {
        calls.push(options.scheduledAt);
        return { externalId: 'graph-timezone-1' };
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
      id: 'post-timezone',
      clientId: 'client-1',
      facebook: 'Timezone test',
      targets: [],
    }]);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId: 'post-timezone',
        accountId: 'facebook:1',
        channel: 'facebook',
        contentType: 'post',
        scheduledLocal: '2026-08-14T10:00',
        timeZone: 'Asia/Taipei',
      }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(calls, ['2026-08-14T02:00:00.000Z']);
    const item = await response.json();
    assert.equal(item.timeZone, 'Asia/Taipei');
    const target = (await readJson(jsonFiles.posts, []))[0].targets[0];
    assert.equal(target.scheduledAt, '2026-08-14T02:00:00.000Z');
    assert.equal(target.timeZone, 'Asia/Taipei');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /schedule rejects a nonexistent daylight-saving local time before persistence', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => ({ configured: true }),
  }));
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId: 'not-used',
        scheduledLocal: '2026-03-08T02:30',
        timeZone: 'America/New_York',
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'SCHEDULE_DST_NONEXISTENT');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /schedule does not reschedule an already scheduled Facebook target', async () => {
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
    assert.equal(response.status, 409);
    assert.deepEqual(calls, []);
    assert.equal((await readJson(jsonFiles.posts, []))[0].targets[0].externalId, 'graph-old');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /schedule rejects targetId when platform or contentType mismatch', async () => {
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
  }
});

test('POST /schedule rejects an unknown targetId without creating a new target', async () => {
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
      id: 'post-unknown-target',
      clientId: 'client-1',
      facebook: 'Unknown target',
      targets: [{
        id: 'target-existing',
        accountId: 'facebook:1',
        platformId: 'facebook',
        contentType: 'post',
        status: 'draft',
      }],
    }]);

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId: 'post-unknown-target',
        targetId: 'target-does-not-exist',
        accountId: 'facebook:1',
        channel: 'facebook',
        contentType: 'post',
        scheduledAt: '2026-08-15T10:00:00.000Z',
      }),
    });

    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'SCHEDULE_TARGET_NOT_FOUND');
    assert.equal(publishCalls, 0);
    const posts = await readJson(jsonFiles.posts, []);
    assert.equal(posts[0].targets.length, 1);
    assert.equal(posts[0].targets[0].id, 'target-existing');
    assert.equal(posts[0].targets[0].status, 'draft');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /schedule accepts an account id as targetId when that account already has a target', async () => {
  let publishCalls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => ({
      configured: true,
      async publish() {
        publishCalls += 1;
        return { externalId: 'graph-account-id' };
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
      id: 'post-account-as-target',
      clientId: 'client-1',
      facebook: 'Account id as targetId',
      targets: [{
        id: 'target-existing',
        accountId: 'facebook:1',
        platformId: 'facebook',
        contentType: 'post',
        status: 'draft',
      }],
    }]);

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId: 'post-account-as-target',
        targetId: 'facebook:1',
        accountId: 'facebook:1',
        channel: 'facebook',
        contentType: 'post',
        scheduledAt: '2026-08-20T10:00:00.000Z',
      }),
    });

    assert.equal(response.status, 201);
    assert.equal(publishCalls, 1);
    const posts = await readJson(jsonFiles.posts, []);
    assert.equal(posts[0].targets.length, 1);
    assert.equal(posts[0].targets[0].id, 'target-existing');
    assert.equal(posts[0].targets[0].status, 'scheduled');
  } finally {
    await new Promise((resolve) => server.close(resolve));
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

test('Instagram schedule lifecycle stays local and never calls Facebook publisher', async () => {
  let facebookResolverCalls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => {
      facebookResolverCalls += 1;
      throw new Error('Instagram 不應呼叫 Facebook publisher');
    },
  }));
  const server = app.listen(0);

  try {
    await writeJson(jsonFiles.clients, [{
      id: 'client-1',
      accounts: [{ id: 'instagram:1', platformId: 'instagram', configured: true }],
    }]);
    await writeJson(jsonFiles.posts, [{
      id: 'post-instagram',
      clientId: 'client-1',
      facebook: 'Instagram 本機排程',
      mediaPaths: ['/uploads/instagram.jpg'],
      targets: [{
        id: 'target-instagram',
        accountId: 'instagram:1',
        platformId: 'instagram',
        contentType: 'feed',
        status: 'draft',
        externalId: 'stale-id',
      }],
    }]);

    const baseUrl = `http://127.0.0.1:${server.address().port}/api/schedule`;
    const firstScheduledAt = new Date(Date.now() + 120_000).toISOString();
    const postResponse = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId: 'post-instagram',
        targetId: 'target-instagram',
        accountId: 'instagram:1',
        channel: 'instagram',
        contentType: 'feed',
        scheduledAt: firstScheduledAt,
      }),
    });

    assert.equal(postResponse.status, 201);
    assert.equal(facebookResolverCalls, 0);
    const scheduled = await postResponse.json();
    assert.equal(scheduled.status, 'scheduled');
    assert.equal(scheduled.externalId, null);

    const secondScheduledAt = new Date(Date.now() + 180_000).toISOString();
    const patchResponse = await fetch(`${baseUrl}/target-instagram`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt: secondScheduledAt }),
    });
    assert.equal(patchResponse.status, 200);
    assert.equal((await patchResponse.json()).scheduledAt, secondScheduledAt);
    assert.equal(facebookResolverCalls, 0);

    const deleteResponse = await fetch(`${baseUrl}/target-instagram`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 200);
    assert.equal(facebookResolverCalls, 0);
    const cancelled = await deleteResponse.json();
    assert.equal(cancelled.status, 'draft');
    assert.equal(cancelled.scheduledAt, null);
    assert.equal(cancelled.externalId, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PATCH and DELETE /schedule/:targetId synchronize Facebook and local target', async () => {
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
  }
});

test('DELETE /schedule clears local row when Facebook object is already gone', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    resolveFacebookPublisher: async () => ({
      configured: true,
      async deleteScheduled() {
        const error = new Error("Object with ID 'graph-orphan' does not exist");
        error.code = 100;
        error.subcode = 33;
        throw error;
      },
    }),
  }));
  const server = app.listen(0);
  try {
    await writeJson(jsonFiles.clients, [{ id: 'client-1', accounts: [{ id: 'facebook:1', platformId: 'facebook' }] }]);
    await writeJson(jsonFiles.posts, [{
      id: 'post-1',
      clientId: 'client-1',
      facebook: '幽靈排程',
      targets: [{
        id: 'target-gone',
        accountId: 'facebook:1',
        platformId: 'facebook',
        contentType: 'post',
        status: 'scheduled',
        scheduledAt: '2026-08-17T23:00:00.000Z',
        externalId: 'graph-orphan',
      }],
    }]);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/schedule/target-gone`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    const target = (await readJson(jsonFiles.posts, []))[0].targets[0];
    assert.equal(target.status, 'draft');
    assert.equal(target.scheduledAt, null);
    assert.equal(target.externalId, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PATCH marks target failed when Facebook delete succeeds but create fails', async () => {
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
  }
});
