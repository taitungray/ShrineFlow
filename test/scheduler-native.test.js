import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldClaimTargetForLocalPublish } from '../lib/scheduler.js';

test('does not claim facebook scheduled targets that already have externalId', () => {
  assert.equal(
    shouldClaimTargetForLocalPublish({
      platformId: 'facebook',
      status: 'scheduled',
      externalId: '123_456',
      scheduledAt: '2020-01-01T00:00:00.000Z',
    }, new Date()),
    false,
  );
});

test('claims legacy facebook scheduled without externalId when due', () => {
  assert.equal(
    shouldClaimTargetForLocalPublish({
      platformId: 'facebook',
      status: 'scheduled',
      externalId: null,
      scheduledAt: '2020-01-01T00:00:00.000Z',
    }, new Date()),
    true,
  );
});
