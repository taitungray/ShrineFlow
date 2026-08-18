import test from 'node:test';
import assert from 'node:assert/strict';

import { createBackgroundJobStore } from '../lib/background-jobs.js';

test('background job store creates, runs, and completes a recoverable job', () => {
  const store = createBackgroundJobStore({ now: () => 1_000 });
  const created = store.create({ type: 'generate', clientId: 'client-a' });
  assert.equal(created.status, 'queued');
  assert.ok(created.id);

  store.update(created.id, { status: 'running' });
  assert.equal(store.get(created.id).status, 'running');

  store.update(created.id, { status: 'succeeded', result: { facebook: '完成' } });
  const view = store.publicView(store.get(created.id));
  assert.equal(view.status, 'succeeded');
  assert.equal(view.result.facebook, '完成');
  assert.equal(view.clientId, undefined);
});

test('background job store expires old jobs so polling cannot revive stale work', () => {
  let now = 1_000;
  const store = createBackgroundJobStore({ now: () => now, ttlMs: 10_000 });
  const created = store.create({ type: 'rewrite' });
  now = 12_000;
  assert.equal(store.get(created.id), null);
});
