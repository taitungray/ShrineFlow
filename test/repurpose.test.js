import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createInsightsRouter } from '../lib/routes/insights.js';
import { pickRepurposeMetric } from '../lib/repurpose.js';

test('repurpose candidates rank only published targets with saved post Insights', async () => {
  const app = express();
  app.use('/api', createInsightsRouter({
    listClients: async () => [{
      id: 'client-1',
      accounts: [{ id: 'instagram:1', platformId: 'instagram', name: 'IG brand' }],
    }],
    listPosts: async () => [{
      id: 'post-top',
      clientId: 'client-1',
      contentTopic: '高互動祭典準備',
      targets: [{
        id: 'target-top',
        accountId: 'instagram:1',
        platformId: 'instagram',
        status: 'published',
        publishedAt: '2026-08-10T00:00:00.000Z',
      }],
    }, {
      id: 'post-without-snapshot',
      clientId: 'client-1',
      contentTopic: '沒有成效快照的內容',
      targets: [{
        id: 'target-without-snapshot',
        accountId: 'instagram:1',
        platformId: 'instagram',
        status: 'published',
        publishedAt: '2026-08-11T00:00:00.000Z',
      }],
    }],
    findSnapshot: async ({ targetId }) => targetId === 'target-top'
      ? {
        scope: 'post',
        targetId,
        source: 'meta_graph_api',
        fetchedAt: '2026-08-12T00:00:00.000Z',
        data: [
          { name: 'likes', value: 90 },
          { name: 'comments', value: 12 },
        ],
      }
      : null,
  }));
  const server = app.listen(0);

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/insights/repurpose?platform=instagram`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, 'ready');
    assert.equal(payload.source, 'saved_post_insights_only');
    assert.equal(payload.publishedTargetCount, 2);
    assert.equal(payload.candidateCount, 1);
    assert.equal(payload.excludedCount, 1);
    assert.equal(payload.candidates[0].postId, 'post-top');
    assert.equal(payload.candidates[0].metric.name, 'comments');
    assert.equal(payload.candidates[0].metric.value, 12);
    assert.equal(payload.candidates[0].snapshot, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('pickRepurposeMetric reads Graph total_value', () => {
  const metric = pickRepurposeMetric('facebook', [
    { name: 'post_media_view', total_value: { value: 88 } },
  ]);
  assert.deepEqual(metric, { name: 'post_media_view', value: 88 });
});
