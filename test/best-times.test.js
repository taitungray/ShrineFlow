import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { analyzeBestTimes } from '../lib/best-times.js';
import { createBestTimesRouter } from '../lib/routes/best-times.js';

function publishedAt(day, hour) {
  return new Date(`2026-08-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+08:00`).toISOString();
}

test('best timing suggestions stay empty only when there are no published records', () => {
  const result = analyzeBestTimes([], { clientId: 'client-1', timeZone: 'Asia/Taipei' });
  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.sampleCount, 0);
  assert.deepEqual(result.slots, []);
  assert.equal(result.dataQuality, 'insufficient');
  assert.equal(result.minimumSamples, 1);
  assert.equal(result.source, 'local_published_targets');
});

test('best timing suggestions show slots from a single published record', () => {
  const result = analyzeBestTimes([
    { clientId: 'client-1', platformId: 'instagram', accountId: 'ig-1', status: 'published', publishedAt: publishedAt(15, 9) },
  ], { clientId: 'client-1', timeZone: 'Asia/Taipei' });
  assert.equal(result.status, 'ok');
  assert.equal(result.sampleCount, 1);
  assert.equal(result.dataQuality, 'thin');
  assert.equal(result.slots.length, 1);
  assert.equal(result.slots[0].localHour, '09:00');
  assert.equal(result.slots[0].weekdayLabel, '六');
  assert.equal(result.source, 'local_published_targets');
});

test('best timing suggestions rank local published buckets without changing queue data', () => {
  const records = [];
  for (let index = 0; index < 10; index += 1) {
    records.push({
      clientId: 'client-1',
      platformId: 'instagram',
      accountId: 'ig-1',
      status: 'published',
      publishedAt: new Date(Date.UTC(2026, 0, 5 + index * 7, 1, 0)).toISOString(),
    });
  }
  records.push({ clientId: 'client-1', platformId: 'instagram', accountId: 'ig-1', status: 'published', publishedAt: publishedAt(3, 15) });
  const result = analyzeBestTimes(records, { clientId: 'client-1', platformId: 'instagram', timeZone: 'Asia/Taipei' });
  assert.equal(result.status, 'ok');
  assert.equal(result.sampleCount, 11);
  assert.equal(result.dataQuality, 'adequate');
  assert.equal(result.slots[0].localHour, '09:00');
  assert.equal(result.slots[0].sampleCount, 10);
  assert.equal(result.algorithmVersion, 'local-publish-v1');
});

test('GET /insights/best-times returns slots once any published target exists', async (t) => {
  const posts = [{
    id: 'post-1',
    clientId: 'client-1',
    targets: [{ platformId: 'facebook', accountId: 'fb-1', status: 'published', publishedAt: publishedAt(15, 10) }],
  }];
  const app = express();
  app.use('/api', createBestTimesRouter({
    getClient: async () => ({ id: 'client-1', name: '測試品牌' }),
    listClients: async () => [{ id: 'client-1', name: '測試品牌' }],
    listPosts: async () => posts,
  }));
  const server = app.listen(0);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/insights/best-times?clientId=client-1`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.clientId, 'client-1');
  assert.equal(body.status, 'ok');
  assert.equal(body.minimumSamples, 1);
  assert.equal(body.dataQuality, 'thin');
  assert.equal(body.slots.length, 1);
  assert.equal(body.slots[0].localHour, '10:00');
});
