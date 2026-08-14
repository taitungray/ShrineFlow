import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createFacebookInboxClient,
  createInstagramInboxClient,
  createThreadsInboxClient,
  InboxApiError,
} from '../lib/inbox.js';
import { createInboxRouter } from '../lib/routes/inbox.js';
import { getInboxSyncHint, markInboxSyncHint, saveInboxCursor } from '../lib/inbox-metadata.js';
import { jsonFiles } from '../lib/store.js';

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

test('Facebook, Instagram and Threads reply adapters use provider write endpoints', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return response({ message_id: 'message-1', id: 'thread-reply-1' });
  };
  const facebook = createFacebookInboxClient({ pageId: 'page-1', pageAccessToken: 'page-token', fetchImpl });
  const instagram = createInstagramInboxClient({ userId: 'ig-1', accessToken: 'ig-token', fetchImpl });
  const threads = createThreadsInboxClient({ userId: 'threads-1', accessToken: 'threads-token', fetchImpl });

  await facebook.reply({ recipientId: 'psid-1', text: 'Facebook reply' });
  await instagram.reply({ recipientId: 'igsid-1', text: 'Instagram reply' });
  await threads.reply({ replyToId: 'thread-1', text: 'Threads reply' });

  assert.equal(calls[0].options.method, 'POST');
  assert.equal(JSON.parse(calls[0].options.body).recipient.id, 'psid-1');
  assert.match(calls[0].url, /\/v25\.0\/page-1\/messages/);
  assert.equal(JSON.parse(calls[1].options.body).recipient.id, 'igsid-1');
  assert.match(calls[1].url, /\/v25\.0\/ig-1\/messages/);
  assert.match(calls[2].url, /\/v1\.0\/me\/threads/);
  assert.match(calls[2].url, /reply_to_id=thread-1/);
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

test('Inbox route overlays local metadata and exposes provider cursor state', async () => {
  const originalPath = jsonFiles.inboxMetadata;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-inbox-route-'));
  jsonFiles.inboxMetadata = path.join(temporaryDirectory, 'inbox-metadata.json');
  const app = express();
  app.use(express.json());
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
          paging: { cursors: { after: 'next-page' } },
          items: [{ id: 'reply-1', type: 'reply', text: 'Provider text', unread: true }],
        };
      },
    }),
  }));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/inbox`;
    const first = await fetch(base);
    const firstPayload = await first.json();
    assert.equal(firstPayload.sources[0].cursor.available, true);
    const update = await fetch(`${base}/items/reply-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-1',
        accountId: 'threads:1',
        platformId: 'threads',
        unread: false,
        tags: ['VIP'],
        note: '追蹤回覆',
      }),
    });
    assert.equal(update.status, 200);
    const second = await fetch(base);
    const secondPayload = await second.json();
    const item = secondPayload.sources[0].items[0];
    assert.equal(item.unread, false);
    assert.deepEqual(item.tags, ['VIP']);
    assert.equal(item.note, '追蹤回覆');
    assert.equal(JSON.stringify(secondPayload).includes('next-page'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    jsonFiles.inboxMetadata = originalPath;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('Inbox reply route returns provider sent state and never stores reply body', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createInboxRouter({
    listClients: async () => [],
    getClient: async () => ({
      id: 'client-1',
      accounts: [{ id: 'threads:1', platformId: 'threads', configured: true }],
    }),
    resolveThreadsInbox: async () => ({
      configured: true,
      async reply({ replyToId, text }) {
        assert.equal(replyToId, 'reply-1');
        assert.equal(text, 'provider reply');
        return { platformId: 'threads', messageId: 'sent-1', replyToId };
      },
    }),
  }));
  const server = app.listen(0);
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/inbox/items/reply-1/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-1',
        accountId: 'threads:1',
        platformId: 'threads',
        text: 'provider reply',
      }),
    });
    const payload = await result.json();
    assert.equal(result.status, 201);
    assert.equal(payload.status, 'sent');
    assert.equal(payload.messageId, 'sent-1');
    assert.equal(JSON.stringify(payload).includes('provider reply'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Inbox provider refresh ignores a stale cursor after a webhook sync hint', async () => {
  const originalPath = jsonFiles.inboxMetadata;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-inbox-webhook-refresh-'));
  jsonFiles.inboxMetadata = path.join(temporaryDirectory, 'inbox-metadata.json');
  const afterValues = [];
  const identity = { clientId: 'client-1', accountId: 'facebook:page-1', platformId: 'facebook' };
  await saveInboxCursor(identity, 'stale-cursor');
  await markInboxSyncHint(identity, { eventType: 'messages' });
  const app = express();
  app.use('/api', createInboxRouter({
    listClients: async () => [{
      id: 'client-1',
      accounts: [{ id: identity.accountId, platformId: identity.platformId, name: 'Facebook brand', configured: true, credentials: { pageId: 'page-1' } }],
    }],
    resolveFacebookInbox: async () => ({
      configured: true,
      async fetchRecent({ after }) {
        afterValues.push(after);
        return {
          platformId: 'facebook',
          source: 'meta_graph_api',
          fetchedAt: '2026-08-14T00:00:00.000Z',
          items: [],
          paging: null,
        };
      },
    }),
  }));
  const server = app.listen(0);
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/inbox?useCursor=true`);
    const payload = await result.json();
    assert.equal(result.status, 200);
    assert.deepEqual(afterValues, ['']);
    assert.equal(payload.sources[0].syncPending, true);
    assert.equal(await getInboxSyncHint(identity), null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    jsonFiles.inboxMetadata = originalPath;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('Inbox filters only the provider window and preserves manual pending state', async () => {
  const originalPath = jsonFiles.inboxMetadata;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-inbox-filter-'));
  jsonFiles.inboxMetadata = path.join(temporaryDirectory, 'inbox-metadata.json');
  const app = express();
  app.use(express.json());
  app.use('/api', createInboxRouter({
    getClient: async (clientId) => clientId === 'client-filter' ? {
      id: 'client-filter',
      accounts: [{ id: 'threads:filter', name: 'Threads', platformId: 'threads', configured: true }],
    } : null,
    listClients: async () => [{
      id: 'client-filter',
      accounts: [{ id: 'threads:filter', name: 'Threads', platformId: 'threads', configured: true }],
    }],
    resolveThreadsInbox: async () => ({
      configured: true,
      async fetchRecent() {
        return {
          platformId: 'threads',
          source: 'meta_graph_api',
          fetchedAt: '2026-08-14T00:00:00.000Z',
          items: [
            { id: 'unread-item', text: 'Unread', unread: true },
            { id: 'read-item', text: 'Read', unread: false },
          ],
        };
      },
    }),
  }));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/inbox?clientId=client-filter`;
    const unread = await fetch(`${base}&unreadOnly=true`);
    const unreadPayload = await unread.json();
    assert.equal(unread.status, 200);
    assert.equal(unreadPayload.dataScope, 'provider_window');
    assert.equal(unreadPayload.filter.unreadOnly, true);
    assert.deepEqual(unreadPayload.sources[0].items.map((item) => item.id), ['unread-item']);
    assert.equal(unreadPayload.sources[0].providerItemCount, 2);
    assert.equal(unreadPayload.sources[0].filteredOutCount, 1);

    const pendingUpdate = await fetch(`${base.replace('?clientId=client-filter', '')}/items/read-item`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-filter', accountId: 'threads:filter', platformId: 'threads', needsReply: true }),
    });
    assert.equal(pendingUpdate.status, 200);
    const pending = await fetch(`${base}&needsReplyOnly=true`);
    const pendingPayload = await pending.json();
    assert.deepEqual(pendingPayload.sources[0].items.map((item) => item.id), ['read-item']);
    assert.equal(pendingPayload.sources[0].items[0].needsReply, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    jsonFiles.inboxMetadata = originalPath;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
