import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createPublishRouter } from '../lib/routes/publish.js';

function createRepositories(initialPosts) {
  const posts = structuredClone(initialPosts);
  return {
    posts: {
      async list() { return posts; },
      async mutate(mutator) { return mutator(posts); },
    },
  };
}

test('first comment is an independent child delivery and replay does not publish the main post again', async (t) => {
  const repositories = createRepositories([{
    id: 'post-1',
    clientId: 'client-1',
    status: 'published',
    targets: [{
      id: 'target-1',
      accountId: 'instagram-1',
      platformId: 'instagram',
      status: 'published',
      externalId: 'media-1',
      delivery: { firstComment: { status: 'failed', text: '首則留言', lastError: { message: 'temporary' } } },
    }],
  }]);
  let calls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api', createPublishRouter({
    repositories,
    getClient: async () => ({ id: 'client-1', accounts: [{ id: 'instagram-1', platformId: 'instagram', configured: true }] }),
    resolveInstagramPublisher: async () => ({
      configured: true,
      async publishFirstComment({ mediaId, text }) {
        calls += 1;
        assert.equal(mediaId, 'media-1');
        assert.equal(text, '首則留言');
        return { externalId: 'comment-1' };
      },
    }),
  }));
  const server = app.listen(0);
  t.after(() => server.close());

  const url = `http://127.0.0.1:${server.address().port}/api/publish/target/first-comment`;
  const first = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId: 'post-1', targetId: 'target-1' }),
  });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).firstComment.externalId, 'comment-1');
  assert.equal(calls, 1);

  const second = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId: 'post-1', targetId: 'target-1' }),
  });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).replayed, true);
  assert.equal(calls, 1);
  assert.equal(repositories.posts ? (await repositories.posts.list())[0].targets[0].status : '', 'published');
  assert.equal((await repositories.posts.list())[0].targets[0].delivery.firstComment.status, 'published');
});

test('first comment failure keeps the main target published and returns a separate failure', async (t) => {
  const repositories = createRepositories([{
    id: 'post-2', clientId: 'client-1', status: 'published', targets: [{
      id: 'target-2', accountId: 'instagram-1', platformId: 'instagram', status: 'published', externalId: 'media-2',
      delivery: { firstComment: { status: 'failed', text: '稍後留言' } },
    }],
  }]);
  const app = express();
  app.use(express.json());
  app.use('/api', createPublishRouter({
    repositories,
    getClient: async () => ({ id: 'client-1', accounts: [{ id: 'instagram-1', platformId: 'instagram', configured: true }] }),
    resolveInstagramPublisher: async () => ({
      configured: true,
      async publishFirstComment() { throw new Error('權限不足'); },
    }),
  }));
  const server = app.listen(0);
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/publish/target/first-comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId: 'post-2', targetId: 'target-2' }),
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, 'FIRST_COMMENT_FAILED');
  const target = (await repositories.posts.list())[0].targets[0];
  assert.equal(target.status, 'published');
  assert.equal(target.delivery.firstComment.status, 'failed');
});
