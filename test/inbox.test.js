import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import {
  createFacebookInboxClient,
  createInstagramInboxClient,
  createThreadsInboxClient,
  InboxApiError,
} from '../lib/inbox.js';
import { createInboxRouter } from '../lib/routes/inbox.js';

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test('Facebook and Instagram Inbox adapters read recent conversations with bearer auth', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    return response({ data: [{ id: 'conversation-1', snippet: 'Hello', updated_time: '2026-08-14T00:00:00.000Z' }] });
  };

  const facebook = await createFacebookInboxClient({
    pageId: 'page-1',
    pageAccessToken: 'secret-page-token',
    fetchImpl,
  }).fetchRecent({ limit: 10 });
  const instagram = await createInstagramInboxClient({
    userId: 'ig-1',
    accessToken: 'secret-ig-token',
    fetchImpl,
  }).fetchRecent({ limit: 10 });

  assert.equal(facebook.items[0].text, 'Hello');
  assert.equal(instagram.items[0].platformId, 'instagram');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer secret-page-token');
  assert.doesNotMatch(requests[0].url, /secret-page-token/);
  assert.match(requests[0].url, /\/v25\.0\/page-1\/conversations/);
  assert.match(requests[1].url, /\/v25\.0\/ig-1\/conversations/);
});

test('Threads Inbox adapter expands recent threads into normalized replies', async () => {
  const requests = [];
  const client = createThreadsInboxClient({
    userId: 'threads-1',
    accessToken: 'secret-threads-token',
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url).includes('/threads?')) {
        return response({ data: [{ id: 'thread-1', text: 'Root post', timestamp: '2026-08-14T00:00:00.000Z' }] });
      }
      return response({ data: [{ id: 'reply-1', text: 'A reply', username: 'reader', timestamp: '2026-08-14T00:01:00.000Z' }] });
    },
  });

  const result = await client.fetchRecent({ limit: 5 });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].type, 'reply');
  assert.equal(result.items[0].author, 'reader');
  assert.match(requests[0], /\/v1\.0\/threads-1\/threads/);
  assert.match(requests[1], /\/v1\.0\/thread-1\/conversation/);
});

test('Inbox adapter classifies provider errors and route keeps provider-backed boundary', async () => {
  const client = createInstagramInboxClient({
    userId: 'ig-1',
    accessToken: 'secret-token',
    fetchImpl: async () => response({ error: { message: 'Permission denied', code: 200 } }, 403),
  });
  await assert.rejects(
    client.fetchRecent(),
    (error) => error instanceof InboxApiError && error.category === 'authentication' && error.status === 403,
  );

  const app = express();
  app.use('/api', createInboxRouter({
    listClients: async () => [{
      id: 'client-1',
      accounts: [{ id: 'threads:1', name: 'Threads brand', platformId: 'threads', configured: true }],
    }],
    resolveThreadsInbox: async () => ({
      configured: true,
      async fetchRecent() {
        return {
          platformId: 'threads',
          source: 'meta_graph_api',
          fetchedAt: '2026-08-14T00:00:00.000Z',
          items: [{ id: 'reply-1', type: 'reply', text: 'Real reply', author: 'reader' }],
        };
      },
    }),
  }));
  const server = app.listen(0);
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/inbox`);
    const payload = await result.json();
    assert.equal(result.status, 200);
    assert.equal(payload.status, 'synced');
    assert.equal(payload.retention, 'provider_backed');
    assert.equal(payload.sources[0].items[0].text, 'Real reply');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
