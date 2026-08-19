import assert from 'node:assert/strict';
import test from 'node:test';

import { extractAllMetrics, metricDisplayValue } from '../public/modules/insights-metrics.js';

test('metricDisplayValue reads Graph total_value used by Instagram and newer Page posts', () => {
  assert.equal(metricDisplayValue({ name: 'likes', total_value: { value: 18 } }), 18);
  assert.equal(metricDisplayValue({ name: 'views', values: [{ value: 4 }, { value: 7 }] }), 11);
  assert.equal(metricDisplayValue({ name: 'likes', value: 3 }), 3);
});

test('extractAllMetrics maps Facebook v25 post names instead of treating missing likes/reach as zero', () => {
  const metrics = extractAllMetrics({
    status: 'synced',
    data: [
      { name: 'likes', value: 0 },
      { name: 'post_reactions_like_total', values: [{ value: 12 }] },
      { name: 'post_media_view', total_value: { value: 240 } },
      { name: 'post_engaged_users', values: [{ value: 19 }] },
      { name: 'comments', value: 2 },
      { name: 'shares', value: 1 },
    ],
  });

  assert.equal(metrics.available, true);
  assert.equal(metrics.likes, 12);
  assert.equal(metrics.comments, 2);
  assert.equal(metrics.shares, 1);
  assert.equal(metrics.reach, 240);
  assert.equal(metrics.total, 19);
});

test('extractAllMetrics reads post_activity_by_action_type when object fields are the only signal', () => {
  const metrics = extractAllMetrics({
    status: 'synced',
    data: [{
      name: 'post_activity_by_action_type',
      values: [{ value: { like: 5, comment: 3, share: 2 } }],
    }],
  });

  assert.equal(metrics.likes, 5);
  assert.equal(metrics.comments, 3);
  assert.equal(metrics.shares, 2);
  assert.equal(metrics.total, 10);
});

test('extractAllMetrics keeps missing sync as empty, not fake zeros', () => {
  assert.deepEqual(extractAllMetrics(undefined), {
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    reach: null,
    total: null,
    available: false,
  });
  assert.equal(extractAllMetrics({ status: 'error', data: [] }).available, false);
  assert.equal(extractAllMetrics({ status: 'synced', data: [{ name: 'likes', value: 0 }] }).likes, 0);
});
