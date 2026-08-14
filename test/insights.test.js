import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createInsightsRouter } from '../lib/routes/insights.js';
import { directories } from '../lib/store.js';
import { appendInsightsSnapshot, findLatestInsightsSnapshot } from '../lib/insights-snapshots.js';
import {
  createFacebookInsightsClient,
  createInstagramInsightsClient,
  createThreadsInsightsClient,
  InsightsApiError,
} from '../lib/insights.js';

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test('Instagram Insights adapter uses GET, metrics and bearer auth without putting token in URL', async () => {
  let request;
  const client = createInstagramInsightsClient({
    userId: 'ig-user-1',
    accessToken: 'secret-token',
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return response({ data: [{ name: 'views', values: [{ value: 12 }] }] });
    },
  });

  const result = await client.fetchAccountInsights({
    since: '2026-08-01T00:00:00.000Z',
    until: '2026-08-02T00:00:00.000Z',
    metrics: ['views', 'likes'],
  });

  assert.equal(result.platformId, 'instagram');
  assert.equal(result.source, 'meta_graph_api');
  assert.equal(result.data[0].name, 'views');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Authorization, 'Bearer secret-token');
  assert.match(request.url, /\/v25\.0\/ig-user-1\/insights/);
  assert.match(request.url, /metric=views%2Clikes/);
  assert.doesNotMatch(request.url, /secret-token/);
});

test('Facebook and Threads adapters use their platform insight endpoints', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    return response({ data: [] });
  };

  await createFacebookInsightsClient({
    pageId: 'page-1',
    pageAccessToken: 'page-token',
    fetchImpl,
  }).fetchAccountInsights();
  await createThreadsInsightsClient({
    userId: 'threads-user-1',
    accessToken: 'threads-token',
    fetchImpl,
  }).fetchAccountInsights();

  assert.match(requests[0], /\/v25\.0\/page-1\/insights/);
  assert.match(requests[1], /\/v1\.0\/threads-user-1\/threads_insights/);
});

test('Insights adapter returns classified Graph API errors and rejects ranges over 90 days', async () => {
  const client = createInstagramInsightsClient({
    userId: 'ig-user-1',
    accessToken: 'secret-token',
    fetchImpl: async () => response({ error: { message: 'Permission denied', code: 200 } }, 403),
  });

  await assert.rejects(
    client.fetchAccountInsights(),
    (error) => error instanceof InsightsApiError
      && error.category === 'authentication'
      && error.status === 403,
  );

  await assert.rejects(
    client.fetchAccountInsights({
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-08-01T00:00:00.000Z',
    }),
    (error) => error instanceof InsightsApiError
      && error.category === 'validation'
      && error.status === 400,
  );
});

test('Insights route returns real source states without exposing credentials', async () => {
  const app = express();
  app.use('/api', createInsightsRouter({
    listClients: async () => [{
      id: 'client-1',
      accounts: [{
        id: 'instagram:1',
        name: 'Instagram brand',
        platformId: 'instagram',
        configured: true,
        credentials: { userId: 'private-user', accessToken: 'private-token' },
      }],
    }],
    getClient: async () => null,
    resolveInstagramInsights: async () => ({
      configured: true,
      async fetchAccountInsights() {
        return {
          platformId: 'instagram',
          source: 'meta_graph_api',
          fetchedAt: '2026-08-14T00:00:00.000Z',
          data: [{ name: 'views', values: [{ value: 42 }] }],
        };
      },
    }),
    saveSnapshot: async (snapshot) => snapshot,
    findSnapshot: async () => null,
  }));
  const server = app.listen(0);
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/insights`);
    const payload = await result.json();
    assert.equal(result.status, 200);
    assert.equal(payload.status, 'synced');
    assert.equal(payload.sources[0].accountName, 'Instagram brand');
    assert.equal(payload.sources[0].data[0].values[0].value, 42);
    assert.equal(JSON.stringify(payload).includes('private-token'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Insights snapshots are partitioned by month and retain full history', async () => {
  const originalDirectory = directories.insights;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-insights-'));
  directories.insights = temporaryDirectory;
  try {
    await appendInsightsSnapshot({
      clientId: 'client-1',
      accountId: 'instagram:1',
      platformId: 'instagram',
      fetchedAt: '2026-08-01T00:00:00.000Z',
      data: [{ name: 'views', values: [{ value: 1 }] }],
    });
    await appendInsightsSnapshot({
      clientId: 'client-1',
      accountId: 'instagram:1',
      platformId: 'instagram',
      fetchedAt: '2026-09-01T00:00:00.000Z',
      data: [{ name: 'views', values: [{ value: 2 }] }],
    });

    const files = await fs.readdir(temporaryDirectory);
    assert.deepEqual(files.sort(), ['2026-08.json', '2026-09.json']);
    const latest = await findLatestInsightsSnapshot({
      clientId: 'client-1',
      accountId: 'instagram:1',
      platformId: 'instagram',
    });
    assert.equal(latest.data[0].values[0].value, 2);
  } finally {
    directories.insights = originalDirectory;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('Insights route falls back to a dated cached snapshot when live sync fails', async () => {
  const app = express();
  app.use('/api', createInsightsRouter({
    listClients: async () => [{
      id: 'client-1',
      accounts: [{ id: 'threads:1', platformId: 'threads', configured: true }],
    }],
    resolveThreadsInsights: async () => ({
      configured: true,
      async fetchAccountInsights() {
        throw new InsightsApiError('Threads timeout', { retriable: true, status: 504 });
      },
    }),
    findSnapshot: async () => ({
      fetchedAt: '2026-08-13T00:00:00.000Z',
      source: 'meta_graph_api',
      data: [{ name: 'views', values: [{ value: 9 }] }],
      range: { since: '2026-08-12T00:00:00.000Z', until: '2026-08-13T00:00:00.000Z' },
    }),
    saveSnapshot: async (snapshot) => snapshot,
  }));
  const server = app.listen(0);
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/insights`);
    const payload = await result.json();
    assert.equal(result.status, 200);
    assert.equal(payload.status, 'cached');
    assert.equal(payload.sources[0].status, 'cached');
    assert.equal(payload.sources[0].data[0].values[0].value, 9);
    assert.equal(payload.sources[0].error.category, 'cached');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
