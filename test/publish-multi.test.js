import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';

import { createPublishRouter } from '../lib/routes/publish.js';
import { InstagramPublishError } from '../lib/instagram.js';
import { jsonFiles, readJson, writeJson } from '../lib/store.js';
import { ThreadsPublishError } from '../lib/threads.js';

test('POST /publish/target dispatches Instagram and Threads publishers', async (t) => {
  const originalPosts = await fs.readFile(jsonFiles.posts, 'utf8').catch(() => '[]');
  const originalClients = await fs.readFile(jsonFiles.clients, 'utf8').catch(() => '[]');
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

  async function publish(body) {
    return fetch(`http://127.0.0.1:${server.address().port}/api/publish/target`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.writeFile(jsonFiles.posts, originalPosts, 'utf8');
    await fs.writeFile(jsonFiles.clients, originalClients, 'utf8');
  }
});
