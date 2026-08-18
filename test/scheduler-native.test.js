import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createScheduler, shouldClaimTargetForLocalPublish } from '../lib/scheduler.js';
import { directories, jsonFiles, readJson, writeJson } from '../lib/store.js';

const originalJsonFiles = { ...jsonFiles };
const originalDirectories = { ...directories };
let temporaryDataDirectory;

before(async () => {
  temporaryDataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-scheduler-native-'));
  Object.assign(jsonFiles, {
    posts: path.join(temporaryDataDirectory, 'posts.json'),
    schedule: path.join(temporaryDataDirectory, 'schedule.json'),
    clients: path.join(temporaryDataDirectory, 'clients.json'),
    notifications: path.join(temporaryDataDirectory, 'notifications.json'),
    errorLog: path.join(temporaryDataDirectory, 'error-log.json'),
  });
  directories.publishAttempts = path.join(temporaryDataDirectory, 'publish-attempts');
  await Promise.all([
    writeJson(jsonFiles.posts, []),
    writeJson(jsonFiles.schedule, []),
    writeJson(jsonFiles.clients, []),
    writeJson(jsonFiles.notifications, { version: 1, items: [] }),
    writeJson(jsonFiles.errorLog, { version: 1, items: [] }),
  ]);
});

after(async () => {
  Object.assign(jsonFiles, originalJsonFiles);
  Object.assign(directories, originalDirectories);
  await fs.rm(temporaryDataDirectory, { recursive: true, force: true });
});

test('does not claim facebook scheduled targets that already have externalId', () => {
  assert.equal(
    shouldClaimTargetForLocalPublish({
      platformId: 'facebook',
      status: 'scheduled',
      externalId: '123_456',
      scheduledAt: '2020-01-01T00:00:00.000Z',
    }, new Date()),
    false,
  );
});

test('claims legacy facebook scheduled without externalId when due', () => {
  assert.equal(
    shouldClaimTargetForLocalPublish({
      platformId: 'facebook',
      status: 'scheduled',
      externalId: null,
      scheduledAt: '2020-01-01T00:00:00.000Z',
    }, new Date()),
    true,
  );
});

test('claims due Instagram and Threads targets for local publishing', () => {
  const now = new Date('2026-08-13T08:00:00.000Z');
  for (const platformId of ['instagram', 'threads']) {
    assert.equal(
      shouldClaimTargetForLocalPublish({
        platformId,
        status: 'scheduled',
        externalId: null,
        scheduledAt: '2026-08-13T07:59:00.000Z',
      }, now),
      true,
    );
  }
});

test('claims stale publishing targets that never received an externalId', () => {
  const now = new Date('2026-08-19T00:00:00.000Z');
  assert.equal(
    shouldClaimTargetForLocalPublish({
      platformId: 'facebook',
      status: 'publishing',
      externalId: null,
    }, now),
    true,
  );
  assert.equal(
    shouldClaimTargetForLocalPublish({
      platformId: 'facebook',
      status: 'publishing',
      leaseExpiresAt: '2026-08-19T00:01:00.000Z',
    }, now),
    false,
  );
});

test('does not claim targets paused by the scheduling safety valve', () => {
  const now = new Date('2026-08-13T08:00:00.000Z');
  for (const pauseState of ['paused', 'remote_cancel_failed']) {
    assert.equal(
      shouldClaimTargetForLocalPublish({
        platformId: 'instagram',
        status: 'scheduled',
        scheduledAt: '2026-08-13T07:59:00.000Z',
        pauseState,
      }, now),
      false,
    );
  }
});

test('processDueSchedules dispatches Instagram and Threads with web media paths', async () => {
  const calls = [];
  const factories = [];

  await writeJson(jsonFiles.clients, [{
    id: 'client-1',
    accounts: [
      {
        id: 'instagram:1',
        platformId: 'instagram',
        credentials: { userId: 'ig-user', accessToken: 'ig-token' },
      },
      {
        id: 'threads:1',
        platformId: 'threads',
        credentials: { userId: 'threads-user', accessToken: 'threads-token' },
      },
    ],
  }]);
  await writeJson(jsonFiles.posts, [
    {
      id: 'post-instagram',
      clientId: 'client-1',
      facebook: 'IG 母稿',
      mediaPaths: ['/uploads/base.jpg'],
      targets: [{
        id: 'target-instagram',
        accountId: 'instagram:1',
        platformId: 'instagram',
        contentType: 'feed',
        copyOverride: 'IG 排程文案',
        mediaPaths: ['/uploads/instagram.jpg'],
        status: 'scheduled',
        scheduledAt: '2026-08-13T07:00:00.000Z',
      }],
    },
    {
      id: 'post-threads',
      clientId: 'client-1',
      facebook: 'Threads 排程文案',
      mediaPaths: ['/uploads/threads.png'],
      targets: [{
        id: 'target-threads',
        accountId: 'threads:1',
        platformId: 'threads',
        contentType: 'post',
        status: 'scheduled',
        scheduledAt: '2026-08-13T07:00:00.000Z',
      }],
    },
  ]);

  const publisher = (platformId) => ({
    configured: true,
    async publish(post, options) {
      calls.push({ platformId, post, options });
      return { externalId: `${platformId}-published` };
    },
  });
  const scheduler = createScheduler({
    facebookPublisher: {
      configured: true,
      async publish() {
        throw new Error('Facebook publisher 不應被呼叫');
      },
    },
    createInstagramPublisher(options) {
      factories.push({ platformId: 'instagram', options });
      return publisher('instagram');
    },
    createThreadsPublisher(options) {
      factories.push({ platformId: 'threads', options });
      return publisher('threads');
    },
    resolvePublicMediaBaseUrl: () => 'https://media.example.test',
  });

  await scheduler.processDueSchedules(new Date('2026-08-13T08:00:00.000Z'));

  assert.deepEqual(calls.map((call) => call.platformId), ['instagram', 'threads']);
  assert.equal(calls[0].post.facebook, 'IG 排程文案');
  assert.deepEqual(calls[0].options.mediaWebPaths, ['/uploads/instagram.jpg']);
  assert.deepEqual(calls[1].options.mediaWebPaths, ['/uploads/threads.png']);
  assert.equal('mediaFilePaths' in calls[0].options, false);
  assert.equal('mediaFilePaths' in calls[1].options, false);
  assert.deepEqual(factories.map((entry) => entry.options.publicMediaBaseUrl), [
    'https://media.example.test',
    'https://media.example.test',
  ]);

  const posts = await readJson(jsonFiles.posts, []);
  assert.deepEqual(posts.map((post) => post.targets[0].status), ['published', 'published']);
  assert.deepEqual(posts.map((post) => post.targets[0].attempts), [1, 1]);
  assert.deepEqual(posts.map((post) => post.targets[0].publishAttempts[0].source), ['scheduler', 'scheduler']);
  assert.deepEqual(posts.map((post) => post.targets[0].publishAttempts[0].status), ['succeeded', 'succeeded']);
  assert.deepEqual(posts.map((post) => post.targets[0].externalId), [
    'instagram-published',
    'threads-published',
  ]);
  assert.equal(posts[0].facebookPostId, undefined);
  assert.equal(posts[1].facebookPostId, undefined);
});

test('scheduled Instagram first comment is a separate child delivery', async () => {
  await writeJson(jsonFiles.clients, [{
    id: 'client-1',
    accounts: [{
      id: 'instagram:1',
      platformId: 'instagram',
      credentials: { userId: 'ig-user', accessToken: 'ig-token' },
    }],
  }]);
  await writeJson(jsonFiles.posts, [{
    id: 'post-first-comment',
    clientId: 'client-1',
    facebook: '排程首則留言',
    mediaPaths: ['/uploads/post.jpg'],
    targets: [{
      id: 'target-first-comment',
      accountId: 'instagram:1',
      platformId: 'instagram',
      contentType: 'feed',
      mediaPaths: ['/uploads/post.jpg'],
      status: 'scheduled',
      scheduledAt: '2026-08-13T07:00:00.000Z',
      delivery: { firstComment: { status: 'pending', text: '排程後留言' } },
    }],
  }]);
  const calls = [];
  const scheduler = createScheduler({
    facebookPublisher: { configured: false },
    createInstagramPublisher() {
      return {
        configured: true,
        async publish() { return { externalId: 'ig-media-1' }; },
        async publishFirstComment(payload) {
          calls.push(payload);
          return { externalId: 'ig-comment-1' };
        },
      };
    },
    resolvePublicMediaBaseUrl: () => 'https://media.example.test',
  });
  await scheduler.processDueSchedules(new Date('2026-08-13T08:00:00.000Z'));
  const post = (await readJson(jsonFiles.posts, []))[0];
  assert.equal(post.targets[0].status, 'published');
  assert.equal(post.targets[0].externalId, 'ig-media-1');
  assert.deepEqual(calls, [{ mediaId: 'ig-media-1', text: '排程後留言' }]);
  assert.equal(post.targets[0].delivery.firstComment.status, 'published');
  assert.equal(post.targets[0].delivery.firstComment.externalId, 'ig-comment-1');
});

test('processDueSchedules records a bounded failure notification', async () => {
  await writeJson(jsonFiles.clients, [{
    id: 'client-1',
    accounts: [{
      id: 'threads:1',
      platformId: 'threads',
      credentials: { userId: 'threads-user', accessToken: 'threads-token' },
    }],
  }]);
  await writeJson(jsonFiles.posts, [{
    id: 'post-failed',
    clientId: 'client-1',
    facebook: 'Failure notification',
    targets: [{
      id: 'target-failed',
      accountId: 'threads:1',
      platformId: 'threads',
      contentType: 'post',
      status: 'scheduled',
      scheduledAt: '2026-08-13T07:00:00.000Z',
    }],
  }]);
  await writeJson(jsonFiles.notifications, { version: 1, items: [] });

  const scheduler = createScheduler({
    facebookPublisher: { configured: false },
    createThreadsPublisher() {
      return {
        configured: true,
        async publish() {
          const error = new Error('Threads temporary failure');
          error.code = 'TEMPORARY';
          throw error;
        },
      };
    },
    resolvePublicMediaBaseUrl: () => 'https://media.example.test',
  });
  await scheduler.processDueSchedules(new Date('2026-08-13T08:00:00.000Z'));

  const posts = await readJson(jsonFiles.posts, []);
  assert.equal(posts[0].targets[0].status, 'failed');
  const notifications = await readJson(jsonFiles.notifications, { items: [] });
  assert.equal(notifications.items.length, 1);
  assert.equal(notifications.items[0].targetId, 'target-failed');
  assert.equal(notifications.items[0].message, 'Threads temporary failure');
});
