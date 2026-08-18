import test from 'node:test';
import assert from 'node:assert/strict';

import { targetStatusSummary } from '../public/modules/status.js';

test('targetStatusSummary hides platform names and uniform status', () => {
  assert.equal(targetStatusSummary([]), '');
  assert.equal(targetStatusSummary([{ platformId: 'facebook', status: 'scheduled' }]), '');
  assert.equal(targetStatusSummary([
    { platformId: 'facebook', status: 'scheduled' },
    { platformId: 'instagram', status: 'scheduled' },
  ]), '');
});

test('targetStatusSummary lists mixed statuses without platform prefixes', () => {
  assert.equal(targetStatusSummary([
    { platformId: 'facebook', status: 'scheduled' },
    { platformId: 'instagram', status: 'published' },
  ]), '已排程 · 已發布');
});
