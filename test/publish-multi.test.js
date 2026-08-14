import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

import { createPublishRouter } from '../lib/routes/publish.js';
import { InstagramPublishError } from '../lib/instagram.js';
import { directories, jsonFiles, readJson, writeJson } from '../lib/store.js';
import { ThreadsPublishError } from '../lib/threads.js';

test('POST /publish/target dispatches Instagram and Threads publishers', async (t) => {
  const originalPosts = await fs.readFile(jsonFiles.posts, 'utf8').catch(() => '[]');
  const originalClients = await fs.readFile(jsonFiles.clients, 'utf8').catch(() => '[]');
  const originalAttemptArchiveNames = await fs.readdir(directories.publishAttempts).catch(() => []);
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use('/api', createPublishRouter({
    resolveInstagramPublisher: async (context) => ({
      configured: context.accountId !== 'instagram:missing',
      async publish(post, options) {
        if (context.accountId === 'instagram:no-public-url') {
          throw new InstagramPublishError('尚未設定 PUBLIC_MEDIA_BASE_URL。有媒體時請填公網或 tunnel 網址。');
        }
        if (context.accountId === 'instagram:graph-error') {
          throw new InstagramPublishError('Instagram Graph API rejected the media container.');
        }
        calls.push({ platformId: 'instagram', context, post, options });
        return { externalId: 'ig-media-1' };
      },
    }),
    resolveThreadsPublisher: async (context) => ({
      configured: true,
      async publish(post, options) {
        if (context.accountId === 'threads:no-public-url') {
          throw new ThreadsPublishError('媒體缺少公開網址。');
        }
        calls.push({ platformId: 'threads', context, post, options });
        return { externalId: 'threads-post-1' };
      },
    }),
  }));
  const server = app.listen(0);

  async function publish(body, extraHeaders = {}) {
    return fetch(`http://127.0.0.1:${server.address().port}/api/publish/target`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });
  }

  try {
    await writeJson(jsonFiles.clients, [{
      id: 'client-1',
      accounts: [
        { id: 'instagram:1', platformId: 'instagram', configured: true },
        { id: 'instagram:missing', platformId: 'instagram', configured: false },
        { id: 'instagram:no-public-url', platformId: 'instagram', configured: true },
        { id: 'instagram:graph-error', platformId: 'instagram', configured: true },
        { id: 'threads:1', platformId: 'threads', configured: true },
        { id: 'threads:no-public-url', platformId: 'threads', configured: true },
      ],
    }]);

    await t.test('Instagram receives target web media paths and persists success', async () => {
      calls.length = 0;
      await writeJson(jsonFiles.posts, [{
        id: 'post-instagram',
        clientId: 'client-1',
        facebook: '母稿',
        mediaPaths: ['/uploads/post.jpg'],
        targets: [{
          id: 'target-instagram',
          accountId: 'instagram:1',
          platformId: 'instagram',
          contentType: 'feed',
          contentSettings: { placement: 'profile' },
          copyOverride: 'Instagram 覆寫',
          mediaPaths: ['/uploads/instagram.jpg'],
          status: 'draft',
        }],
      }]);

      const response = await publish({ postId: 'post-instagram', targetId: 'target-instagram' });

      assert.equal(response.status, 200);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].platformId, 'instagram');
      assert.equal(calls[0].context.clientId, 'client-1');
      assert.equal(calls[0].context.accountId, 'instagram:1');
      assert.equal(calls[0].post.facebook, 'Instagram 覆寫');
      assert.equal(calls[0].options.contentType, 'feed');
      assert.deepEqual(calls[0].options.contentSettings, { placement: 'profile' });
      assert.deepEqual(calls[0].options.mediaWebPaths, ['/uploads/instagram.jpg']);
      const target = (await readJson(jsonFiles.posts, []))[0].targets[0];
      assert.equal(target.status, 'published');
      assert.equal(target.externalId, 'ig-media-1');
      assert.equal(target.attempts, 1);
      assert.equal(target.publishAttempts.length, 1);
      assert.equal(target.publishAttempts[0].status, 'succeeded');
      assert.equal(target.publishAttempts[0].source, 'manual');
    });

    await t.test('Instagram without contentType defaults publish options to feed', async () => {
      calls.length = 0;
      await writeJson(jsonFiles.posts, [{
        id: 'post-instagram-default',
        clientId: 'client-1',
        facebook: 'IG 預設格式',
        mediaPaths: ['/uploads/default.jpg'],
        targets: [{
          id: 'target-instagram-default',
          accountId: 'instagram:1',
          platformId: 'instagram',
          status: 'draft',
        }],
      }]);

      const response = await publish({
        postId: 'post-instagram-default',
        targetId: 'target-instagram-default',
      });

      assert.equal(response.status, 200);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].platformId, 'instagram');
      assert.equal(calls[0].options.contentType, 'feed');
    });

    await t.test('Threads dispatches its publisher with post web media paths', async () => {
      calls.length = 0;
      await writeJson(jsonFiles.posts, [{
        id: 'post-threads',
        clientId: 'client-1',
        facebook: 'Threads 母稿',
        mediaPaths: ['/uploads/threads.png'],
        targets: [{
          id: 'target-threads',
          accountId: 'threads:1',
          platformId: 'threads',
          contentType: 'post',
          contentSettings: {},
          status: 'draft',
        }],
      }]);

      const response = await publish({ postId: 'post-threads', targetId: 'target-threads' });

      assert.equal(response.status, 200);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].platformId, 'threads');
      assert.deepEqual(calls[0].options.mediaWebPaths, ['/uploads/threads.png']);
      assert.equal((await response.json()).externalId, 'threads-post-1');
    });

    await t.test('unconfigured platform publisher returns 503', async () => {
      calls.length = 0;
      await writeJson(jsonFiles.posts, [{
        id: 'post-missing',
        clientId: 'client-1',
        facebook: '未設定',
        targets: [{
          id: 'target-missing',
          accountId: 'instagram:missing',
          platformId: 'instagram',
          contentType: 'feed',
          status: 'draft',
        }],
      }]);

      const response = await publish({ postId: 'post-missing', targetId: 'target-missing' });

      assert.equal(response.status, 503);
      assert.equal(calls.length, 0);
      assert.match((await response.json()).error, /Instagram|設定/);
    });

    for (const scenario of [
      {
        platformId: 'instagram',
        accountId: 'instagram:no-public-url',
        targetId: 'target-instagram-no-public-url',
      },
      {
        platformId: 'threads',
        accountId: 'threads:no-public-url',
        targetId: 'target-threads-no-public-url',
      },
    ]) {
      await t.test(`${scenario.platformId} missing public media URL returns 400`, async () => {
        await writeJson(jsonFiles.posts, [{
          id: `post-${scenario.platformId}-no-public-url`,
          clientId: 'client-1',
          facebook: '公開媒體網址測試',
          mediaPaths: ['/uploads/media.jpg'],
          targets: [{
            id: scenario.targetId,
            accountId: scenario.accountId,
            platformId: scenario.platformId,
            contentType: scenario.platformId === 'instagram' ? 'feed' : 'post',
            status: 'draft',
          }],
        }]);

        const response = await publish({
          postId: `post-${scenario.platformId}-no-public-url`,
          targetId: scenario.targetId,
        });

        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /PUBLIC_MEDIA_BASE_URL|公開網址|公開存取/);
      });
    }

    await t.test('other Instagram publish errors remain 502', async () => {
      await writeJson(jsonFiles.posts, [{
        id: 'post-instagram-graph-error',
        clientId: 'client-1',
        facebook: 'Graph 錯誤測試',
        mediaPaths: ['/uploads/media.jpg'],
        targets: [{
          id: 'target-instagram-graph-error',
          accountId: 'instagram:graph-error',
          platformId: 'instagram',
          contentType: 'feed',
          status: 'draft',
        }],
      }]);

      const response = await publish({
        postId: 'post-instagram-graph-error',
        targetId: 'target-instagram-graph-error',
      });

      assert.equal(response.status, 502);
      const posts = await readJson(jsonFiles.posts, []);
      const target = posts[0].targets[0];
      assert.equal(target.status, 'failed');
      assert.match(target.lastError?.message || '', /Graph API|rejected/i);
    });

    await t.test('manual republish of failed target can succeed', async () => {
      calls.length = 0;
      await writeJson(jsonFiles.posts, [{
        id: 'post-instagram-retry',
        clientId: 'client-1',
        facebook: '重發測試',
        mediaPaths: ['/uploads/retry.jpg'],
        targets: [{
          id: 'target-instagram-retry',
          accountId: 'instagram:1',
          platformId: 'instagram',
          contentType: 'feed',
          status: 'failed',
          lastError: { message: '先前失敗', at: '2026-08-13T00:00:00.000Z' },
        }],
      }]);

      const response = await publish({
        postId: 'post-instagram-retry',
        targetId: 'target-instagram-retry',
      });

      assert.equal(response.status, 200);
      const posts = await readJson(jsonFiles.posts, []);
      const target = posts[0].targets[0];
      assert.equal(target.status, 'published');
      assert.equal(target.externalId, 'ig-media-1');
      assert.equal(target.lastError, null);
      assert.equal(calls.length, 1);
    });

    await t.test('idempotency key replays success without publishing twice', async () => {
      calls.length = 0;
      const idempotencyKey = `publish-key-${process.pid}-${Date.now()}`;
      await writeJson(jsonFiles.posts, [{
        id: 'post-idempotent',
        clientId: 'client-1',
        facebook: 'Idempotent post',
        targets: [{
          id: 'target-idempotent',
          accountId: 'instagram:1',
          platformId: 'instagram',
          contentType: 'feed',
          status: 'draft',
        }],
      }]);

      const first = await publish(
        { postId: 'post-idempotent', targetId: 'target-idempotent' },
        { 'Idempotency-Key': idempotencyKey },
      );
      const second = await publish(
        { postId: 'post-idempotent', targetId: 'target-idempotent' },
        { 'Idempotency-Key': idempotencyKey },
      );

      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal((await second.json()).replayed, true);
      assert.equal(calls.length, 1);
      const target = (await readJson(jsonFiles.posts, []))[0].targets[0];
      assert.equal(target.publishAttempts.length, 1);
      assert.equal(target.publishAttempts[0].idempotencyKey, idempotencyKey);
    });

    await t.test('published target rejects duplicate publish and preserves state', async () => {
      calls.length = 0;
      await writeJson(jsonFiles.posts, [{
        id: 'post-already-published',
        clientId: 'client-1',
        facebook: 'Already published',
        targets: [{
          id: 'target-already-published',
          accountId: 'instagram:1',
          platformId: 'instagram',
          contentType: 'feed',
          status: 'published',
          externalId: 'existing-media-1',
          publishedAt: '2026-08-14T00:00:00.000Z',
        }],
      }]);

      const response = await publish({
        postId: 'post-already-published',
        targetId: 'target-already-published',
      });

      assert.equal(response.status, 409);
      assert.equal(calls.length, 0);
      const target = (await readJson(jsonFiles.posts, []))[0].targets[0];
      assert.equal(target.status, 'published');
      assert.equal(target.externalId, 'existing-media-1');
      assert.equal(target.publishAttempts.length, 0);
    });

    await t.test('missing targetId returns 404 instead of selecting another target', async () => {
      calls.length = 0;
      await writeJson(jsonFiles.posts, [{
        id: 'post-missing-target',
        clientId: 'client-1',
        facebook: 'Missing target',
        targets: [{
          id: 'target-existing',
          accountId: 'instagram:1',
          platformId: 'instagram',
          contentType: 'feed',
          status: 'draft',
        }],
      }]);

      const response = await publish({
        postId: 'post-missing-target',
        targetId: 'target-does-not-exist',
      });

      assert.equal(response.status, 404);
      assert.equal(calls.length, 0);
      const target = (await readJson(jsonFiles.posts, []))[0].targets[0];
      assert.equal(target.status, 'draft');
    });

    await t.test('ambiguous publish target requires an explicit targetId', async () => {
      calls.length = 0;
      await writeJson(jsonFiles.posts, [{
        id: 'post-ambiguous-target',
        clientId: 'client-1',
        facebook: 'Ambiguous target',
        targets: [
          {
            id: 'target-instagram-one',
            accountId: 'instagram:1',
            platformId: 'instagram',
            contentType: 'feed',
            status: 'draft',
          },
          {
            id: 'target-instagram-two',
            accountId: 'instagram:graph-error',
            platformId: 'instagram',
            contentType: 'feed',
            status: 'draft',
          },
        ],
      }]);

      const response = await publish({ postId: 'post-ambiguous-target' });

      assert.equal(response.status, 409);
      assert.equal(calls.length, 0);
      const targets = (await readJson(jsonFiles.posts, []))[0].targets;
      assert.deepEqual(targets.map((target) => target.status), ['draft', 'draft']);
    });

    await t.test('provider failure without targetId marks the resolved target failed', async () => {
      calls.length = 0;
      await writeJson(jsonFiles.posts, [{
        id: 'post-fallback-failure',
        clientId: 'client-1',
        facebook: 'Fallback failure',
        mediaPaths: ['/uploads/fallback-failure.jpg'],
        targets: [{
          id: 'target-fallback-failure',
          accountId: 'instagram:graph-error',
          platformId: 'instagram',
          contentType: 'feed',
          status: 'draft',
        }],
      }]);

      const response = await publish({ postId: 'post-fallback-failure' });

      assert.equal(response.status, 502);
      const target = (await readJson(jsonFiles.posts, []))[0].targets[0];
      assert.equal(target.status, 'failed');
      assert.match(target.lastError?.message || '', /Graph API|rejected/i);
      assert.equal(target.publishAttempts[0].status, 'failed');
    });

    const attemptArchiveNames = await fs.readdir(directories.publishAttempts);
    assert.ok(attemptArchiveNames.length >= 1);
    const archivedEvents = [];
    for (const name of attemptArchiveNames) {
      const events = JSON.parse(await fs.readFile(path.join(directories.publishAttempts, name), 'utf8'));
      archivedEvents.push(...events);
    }
    assert.ok(archivedEvents.some((event) => event.eventType === 'started'));
    assert.ok(archivedEvents.some((event) => event.eventType === 'succeeded'));
    assert.ok(archivedEvents.some((event) => event.eventType === 'failed'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.writeFile(jsonFiles.posts, originalPosts, 'utf8');
    await fs.writeFile(jsonFiles.clients, originalClients, 'utf8');
    const currentAttemptArchiveNames = await fs.readdir(directories.publishAttempts).catch(() => []);
    for (const name of currentAttemptArchiveNames) {
      if (!originalAttemptArchiveNames.includes(name)) {
        await fs.unlink(path.join(directories.publishAttempts, name)).catch(() => {});
      }
    }
    const remainingAttemptArchives = await fs.readdir(directories.publishAttempts).catch(() => []);
    if (originalAttemptArchiveNames.length === 0 && remainingAttemptArchives.length === 0) {
      await fs.rmdir(directories.publishAttempts).catch(() => {});
    }
  }
});
