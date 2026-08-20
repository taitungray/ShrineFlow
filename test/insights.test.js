import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createInsightsRouter } from '../lib/routes/insights.js';
import { directories } from '../lib/store.js';
import { appendInsightsSnapshot, findLatestInsightsSnapshot, listInsightsSnapshots } from '../lib/insights-snapshots.js';
import {
  createFacebookInsightsClient,
  createInstagramInsightsClient,
  createThreadsInsightsClient,
  DEFAULT_METRICS,
  DEFAULT_POST_METRICS,
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

async function withInsightsServer(options, run) {
  const app = express();
  app.use('/api', createInsightsRouter(options));
  const server = app.listen(0);
  try {
    const port = server.address().port;
    await run({
      port,
      fetchInsights: (query = '') => fetch(`http://127.0.0.1:${port}/api/insights${query}`),
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function publishedPost({ id = 'post-1', targetId = 'target-1', accountId = 'facebook:1', publishedAt = '2026-08-14T00:00:00.000Z' } = {}) {
  return {
    id,
    clientId: 'client-1',
    contentTopic: id,
    targets: [{
      id: targetId,
      accountId,
      platformId: 'facebook',
      status: 'published',
      externalId: `fb-${targetId}`,
      publishedAt,
    }],
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

  assert.ok(requests.some((url) => /\/v25\.0\/page-1\/insights/.test(url)));
  assert.ok(requests.some((url) => /\/v1\.0\/threads-user-1\/threads_insights/.test(url)));
});

test('post Insights adapters request the platform object insights endpoint', async () => {
  let requestUrl = '';
  const client = createThreadsInsightsClient({
    userId: 'threads-user-1',
    accessToken: 'threads-token',
    fetchImpl: async (url) => {
      requestUrl = String(url);
      return response({ data: [{ name: 'views', value: 11 }] });
    },
  });
  const result = await client.fetchPostInsights({
    externalId: 'thread-99',
    metrics: ['views'],
  });
  assert.equal(result.scope, 'post');
  assert.equal(result.externalId, 'thread-99');
  assert.match(requestUrl, /\/v1\.0\/thread-99\/insights/);
  assert.match(requestUrl, /metric=views/);
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

test('Insights route serves a fresh post snapshot without calling Graph', async () => {
  let liveCalls = 0;
  await withInsightsServer({
    listClients: async () => [{
      id: 'client-1',
      accounts: [{ id: 'facebook:1', name: '粉專', platformId: 'facebook', configured: true }],
    }],
    listPosts: async () => [publishedPost()],
    resolveFacebookInsights: async () => ({
      configured: true,
      async fetchPostInsights() {
        liveCalls += 1;
        return { platformId: 'facebook', scope: 'post', source: 'meta_graph_api', fetchedAt: new Date().toISOString(), data: [] };
      },
    }),
    findSnapshot: async () => ({
      fetchedAt: new Date().toISOString(),
      source: 'meta_graph_api',
      data: [{ name: 'post_clicks', values: [{ value: 4 }] }],
    }),
    saveSnapshot: async (snapshot) => snapshot,
  }, async ({ fetchInsights }) => {
    const result = await fetchInsights('?scope=posts');
    const payload = await result.json();
    assert.equal(result.status, 200);
    assert.equal(liveCalls, 0);
    assert.equal(payload.sources[0].status, 'cached');
    assert.equal(payload.sources[0].cache.reason, 'fresh');
    assert.equal(payload.sources[0].data[0].values[0].value, 4);
    assert.equal(payload.sources[0].error, undefined);
  });
});

test('Insights route live-syncs when refresh=1 even if the snapshot is fresh', async () => {
  let liveCalls = 0;
  await withInsightsServer({
    listClients: async () => [{
      id: 'client-1',
      accounts: [{ id: 'facebook:1', platformId: 'facebook', configured: true }],
    }],
    listPosts: async () => [publishedPost()],
    resolveFacebookInsights: async () => ({
      configured: true,
      async fetchPostInsights({ externalId }) {
        liveCalls += 1;
        return {
          platformId: 'facebook',
          scope: 'post',
          externalId,
          source: 'meta_graph_api',
          fetchedAt: '2026-08-19T12:00:00.000Z',
          data: [{ name: 'post_clicks', values: [{ value: 9 }] }],
        };
      },
    }),
    findSnapshot: async () => ({
      fetchedAt: new Date().toISOString(),
      source: 'meta_graph_api',
      data: [{ name: 'post_clicks', values: [{ value: 4 }] }],
    }),
    saveSnapshot: async (snapshot) => snapshot,
  }, async ({ fetchInsights }) => {
    const result = await fetchInsights('?scope=posts&refresh=1');
    const payload = await result.json();
    assert.equal(liveCalls, 1);
    assert.equal(payload.sources[0].status, 'synced');
    assert.equal(payload.sources[0].data[0].values[0].value, 9);
  });
});

test('Insights route caps live post syncs and defers the rest to saved snapshots', async () => {
  const liveIds = [];
  const posts = Array.from({ length: 5 }, (_, index) => publishedPost({
    id: `post-${index + 1}`,
    targetId: `target-${index + 1}`,
    publishedAt: `2026-08-${String(15 - index).padStart(2, '0')}T00:00:00.000Z`,
  }));
  await withInsightsServer({
    maxLivePostSyncs: 2,
    listClients: async () => [{
      id: 'client-1',
      accounts: [{ id: 'facebook:1', platformId: 'facebook', configured: true }],
    }],
    listPosts: async () => posts,
    resolveFacebookInsights: async () => ({
      configured: true,
      async fetchPostInsights({ externalId }) {
        liveIds.push(externalId);
        return {
          platformId: 'facebook',
          scope: 'post',
          externalId,
          source: 'meta_graph_api',
          fetchedAt: '2026-08-19T12:00:00.000Z',
          data: [{ name: 'post_clicks', values: [{ value: 1 }] }],
        };
      },
    }),
    findSnapshot: async ({ targetId }) => ({
      fetchedAt: '2026-01-01T00:00:00.000Z',
      source: 'meta_graph_api',
      data: [{ name: 'post_clicks', values: [{ value: Number(String(targetId).slice(-1)) }] }],
    }),
    saveSnapshot: async (snapshot) => snapshot,
  }, async ({ fetchInsights }) => {
    const payload = await (await fetchInsights('?scope=posts&limit=5')).json();
    assert.deepEqual(liveIds, ['fb-target-1', 'fb-target-2']);
    assert.equal(payload.sources.filter((source) => source.status === 'synced').length, 2);
    assert.equal(payload.sources.filter((source) => source.cache?.reason === 'deferred').length, 3);
    assert.equal(payload.sources.find((source) => source.targetId === 'target-5').data[0].values[0].value, 5);
  });
});

test('Insights route skips Graph for InvalidID snapshots and records that skip on live failure', async () => {
  let liveCalls = 0;
  const saved = [];
  await withInsightsServer({
    listClients: async () => [{
      id: 'client-1',
      accounts: [{ id: 'facebook:1', platformId: 'facebook', configured: true }],
    }],
    listPosts: async () => [publishedPost()],
    resolveFacebookInsights: async () => ({
      configured: true,
      async fetchPostInsights() {
        liveCalls += 1;
        throw new InsightsApiError('Unsupported get request. Object with ID does not exist', {
          status: 400,
          code: 100,
          subcode: 33,
          category: 'validation',
        });
      },
    }),
    findSnapshot: async () => null,
    saveSnapshot: async (snapshot) => {
      saved.push(snapshot);
      return snapshot;
    },
  }, async ({ fetchInsights }) => {
    const first = await (await fetchInsights('?scope=posts')).json();
    assert.equal(liveCalls, 1);
    assert.equal(saved[0].error.category, 'invalid_id');
    assert.equal(first.sources[0].error.category, 'invalid_id');
  });

  liveCalls = 0;
  await withInsightsServer({
    listClients: async () => [{
      id: 'client-1',
      accounts: [{ id: 'facebook:1', platformId: 'facebook', configured: true }],
    }],
    listPosts: async () => [publishedPost()],
    resolveFacebookInsights: async () => ({
      configured: true,
      async fetchPostInsights() {
        liveCalls += 1;
        throw new Error('should not live-sync invalid IDs');
      },
    }),
    findSnapshot: async () => ({
      fetchedAt: new Date().toISOString(),
      source: 'meta_graph_api',
      data: [],
      error: { category: 'invalid_id', message: 'Object with ID does not exist' },
    }),
    saveSnapshot: async (snapshot) => snapshot,
  }, async ({ fetchInsights }) => {
    const payload = await (await fetchInsights('?scope=posts&refresh=1')).json();
    assert.equal(liveCalls, 0);
    assert.equal(payload.sources[0].status, 'cached');
    assert.equal(payload.sources[0].cache.reason, 'invalid_id');
  });
});

test('Insights route serves a fresh account snapshot without calling Graph', async () => {
  let liveCalls = 0;
  await withInsightsServer({
    listClients: async () => [{
      id: 'client-1',
      accounts: [{ id: 'facebook:1', name: '粉專', platformId: 'facebook', configured: true }],
    }],
    resolveFacebookInsights: async () => ({
      configured: true,
      async fetchAccountInsights() {
        liveCalls += 1;
        return { platformId: 'facebook', source: 'meta_graph_api', fetchedAt: new Date().toISOString(), data: [] };
      },
    }),
    findSnapshot: async () => ({
      fetchedAt: new Date().toISOString(),
      source: 'meta_graph_api',
      range: { since: '2026-08-12T00:00:00.000Z', until: '2026-08-19T00:00:00.000Z' },
      data: [{ name: 'page_impressions', values: [{ value: 80 }] }],
    }),
    saveSnapshot: async (snapshot) => snapshot,
  }, async ({ fetchInsights }) => {
    const since = Math.floor(Date.parse('2026-08-12T00:00:00.000Z') / 1000);
    const until = Math.floor(Date.parse('2026-08-19T00:00:00.000Z') / 1000);
    const payload = await (await fetchInsights(`?scope=account&since=${since}&until=${until}`)).json();
    assert.equal(liveCalls, 0);
    assert.equal(payload.sources[0].status, 'cached');
    assert.equal(payload.sources[0].cache.reason, 'fresh');
    assert.equal(payload.sources[0].data[0].values[0].value, 80);
  });
});

test('insights UI only sends refresh=1 from the 重新同步 button', async () => {
  const js = await fs.readFile(new URL('../public/modules/insights.js', import.meta.url), 'utf8');
  assert.match(js, /liveRefresh/);
  assert.match(js, /refresh=1/);
  assert.match(js, /loadInsightsDetail\(\{\s*refreshAccount:\s*true,\s*liveRefresh:\s*true\s*\}\)/);
});

test('Insights route reads published targets and keeps post scope separate', async () => {
  const saved = [];
  const app = express();
  app.use('/api', createInsightsRouter({
    listClients: async () => [{
      id: 'client-1',
      accounts: [{
        id: 'threads:1',
        name: 'Threads brand',
        platformId: 'threads',
        configured: true,
      }],
    }],
    listPosts: async () => [{
      id: 'post-1',
      clientId: 'client-1',
      contentTopic: '測試內容',
      targets: [{
        id: 'target-1',
        accountId: 'threads:1',
        platformId: 'threads',
        status: 'published',
        externalId: 'thread-1',
        publishedAt: '2026-08-14T00:00:00.000Z',
      }],
    }],
    resolveThreadsInsights: async () => ({
      configured: true,
      async fetchPostInsights({ externalId }) {
        return {
          platformId: 'threads',
          scope: 'post',
          externalId,
          source: 'meta_graph_api',
          fetchedAt: '2026-08-14T00:00:00.000Z',
          data: [{ name: 'views', value: 11 }],
        };
      },
    }),
    findSnapshot: async () => null,
    saveSnapshot: async (snapshot) => {
      saved.push(snapshot);
      return snapshot;
    },
  }));
  const server = app.listen(0);
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/insights?scope=posts`);
    const payload = await result.json();
    assert.equal(result.status, 200);
    assert.equal(payload.scope, 'posts');
    assert.equal(payload.sources[0].status, 'synced');
    assert.equal(payload.sources[0].targetId, 'target-1');
    assert.equal(saved[0].scope, 'post');
    assert.equal(saved[0].targetId, 'target-1');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('post Insights snapshots can be queried by target and remain bounded per request', async () => {
  const originalDirectory = directories.insights;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-post-insights-'));
  directories.insights = temporaryDirectory;
  try {
    await appendInsightsSnapshot({
      clientId: 'client-1',
      accountId: 'threads:1',
      platformId: 'threads',
      scope: 'post',
      targetId: 'target-1',
      fetchedAt: '2026-08-14T00:00:00.000Z',
      data: [{ name: 'views', value: 11 }],
    });
    const history = await listInsightsSnapshots({
      clientId: 'client-1',
      accountId: 'threads:1',
      platformId: 'threads',
      scope: 'post',
      targetId: 'target-1',
      limit: 1,
    });
    assert.equal(history.length, 1);
    assert.equal(history[0].scope, 'post');
    assert.equal((await findLatestInsightsSnapshot({
      clientId: 'client-1',
      accountId: 'threads:1',
      platformId: 'threads',
      scope: 'post',
      targetId: 'target-1',
    })).targetId, 'target-1');
  } finally {
    directories.insights = originalDirectory;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('default Insights catalogs cover organic Page, IG and Threads metrics', () => {
  for (const metric of ['page_impressions', 'page_media_view', 'page_video_views', 'page_fans', 'page_post_engagements']) {
    assert.ok(DEFAULT_METRICS.facebook.includes(metric), metric);
  }
  for (const metric of ['post_media_view', 'post_clicks', 'post_reactions_like_total', 'post_video_views']) {
    assert.ok(DEFAULT_POST_METRICS.facebook.includes(metric), metric);
  }
  for (const metric of ['views', 'reach', 'likes', 'comments', 'shares', 'saves', 'accounts_engaged']) {
    assert.ok(DEFAULT_METRICS.instagram.includes(metric), metric);
  }
  for (const metric of ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions']) {
    assert.ok(DEFAULT_POST_METRICS.instagram.includes(metric), metric);
  }
  for (const metric of ['views', 'likes', 'replies', 'reposts', 'quotes', 'clicks', 'followers_count', 'shares']) {
    assert.ok(DEFAULT_METRICS.threads.includes(metric), metric);
  }
});

test('Insights adapter keeps valid metrics when Meta rejects one name', async () => {
  const requested = [];
  const client = createFacebookInsightsClient({
    pageId: 'page-1',
    pageAccessToken: 'page-token',
    fetchImpl: async (url) => {
      const metric = new URL(String(url)).searchParams.get('metric') || '';
      requested.push(metric);
      if (metric.split(',').includes('dead_metric')) {
        return response({ error: { message: '(#100) The value must be a valid insights metric', code: 100 } }, 400);
      }
      return response({
        data: metric.split(',').filter(Boolean).map((name) => ({ name, values: [{ value: 1 }] })),
      });
    },
  });

  const result = await client.fetchAccountInsights({
    since: '2026-08-01T00:00:00.000Z',
    until: '2026-08-02T00:00:00.000Z',
    metrics: ['page_views_total', 'dead_metric', 'page_follows'],
  });

  assert.deepEqual(result.data.map((item) => item.name).sort(), ['page_follows', 'page_views_total']);
  assert.deepEqual(result.skippedMetrics, ['dead_metric']);
  assert.ok(requested.some((metric) => metric.includes('dead_metric')));
});

test('Facebook post Insights merge object engagement fields', async () => {
  const urls = [];
  const client = createFacebookInsightsClient({
    pageId: 'page-1',
    pageAccessToken: 'page-token',
    fetchImpl: async (url) => {
      urls.push(String(url));
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith('/insights')) {
        return response({ data: [{ name: 'post_clicks', values: [{ value: 5 }] }] });
      }
      return response({
        likes: { summary: { total_count: 3 } },
        comments: { summary: { total_count: 1 } },
        shares: { count: 2 },
        reactions: { summary: { total_count: 4 } },
      });
    },
  });

  const result = await client.fetchPostInsights({
    externalId: 'page-1_99',
    metrics: ['post_clicks'],
  });

  assert.equal(result.scope, 'post');
  assert.deepEqual(
    result.data.map((item) => [item.name, item.value ?? item.values?.[0]?.value]),
    [
      ['post_clicks', 5],
      ['likes', 3],
      ['comments', 1],
      ['shares', 2],
      ['reactions', 4],
    ],
  );
  assert.ok(urls.some((url) => url.includes('/page-1_99/insights')));
  assert.ok(urls.some((url) => url.includes('fields=') && url.includes('likes.summary')));
});

test('Facebook post Insights falls back to post engagement fields when /insights is rejected by Meta', async () => {
  const client = createFacebookInsightsClient({
    pageId: 'page-1',
    pageAccessToken: 'token-1',
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith('/insights')) {
        return response({
          error: {
            message: 'Tried accessing nonexisting field (insights) on node type (Post)',
            type: 'OAuthException',
            code: 100,
          },
        }, { status: 400 });
      }
      return response({
        likes: { summary: { total_count: 12 } },
        comments: { summary: { total_count: 5 } },
        shares: { count: 3 },
        reactions: { summary: { total_count: 15 } },
      });
    },
  });

  const result = await client.fetchPostInsights({
    externalId: 'page-1_101',
  });

  assert.equal(result.scope, 'post');
  assert.deepEqual(
    result.data.map((item) => [item.name, item.value]),
    [
      ['likes', 12],
      ['comments', 5],
      ['shares', 3],
      ['reactions', 15],
    ],
  );
});

test('Insights router provides AI analysis endpoint with structured advice', async () => {
  let analyzedPayload = null;
  const fakeAiService = {
    configured: true,
    analyzeContentPerformance: async (payload) => {
      analyzedPayload = payload;
      return {
        summary: '受眾對節慶與祈福題材反應極佳。',
        topThemes: [{ theme: '關聖帝君誕辰', whyItWorked: '節慶共鳴強' }],
        actionableTips: ['建議文案開頭加強祈福引言'],
        nextPostIdeas: [{
          title: '日常祈安文',
          topic: '關聖帝君',
          format: '圖文',
          reason: '維持平日互動',
          prompt: '撰寫一篇向關聖帝君祈求平安的文案',
        }],
      };
    },
  };

  const router = createInsightsRouter({
    aiService: fakeAiService,
    getClient: async (id) => ({ id, name: '測試宮廟' }),
    listClients: async () => [{ id: 'client-1', name: '測試宮廟' }],
    listPosts: async () => [
      {
        id: 'post-1',
        clientId: 'client-1',
        contentTopic: '關聖帝君聖誕',
        targets: [{ platformId: 'facebook', status: 'published', publishedAt: new Date().toISOString() }],
      },
    ],
  });

  const app = express();
  app.use(express.json());
  app.use('/api', router);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/insights/ai-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-1', platform: 'facebook' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.summary, '受眾對節慶與祈福題材反應極佳。');
    assert.equal(data.topThemes.length, 1);
    assert.equal(data.nextPostIdeas.length, 1);
    assert.equal(analyzedPayload?.clientName, '測試宮廟');
    assert.equal(analyzedPayload?.posts?.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
