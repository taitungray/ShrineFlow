import test from 'node:test';
import assert from 'node:assert/strict';

import { isStalePublishingLock, STALE_PUBLISHING_LOCK_MS } from '../lib/publish-lock.js';

const now = new Date('2026-08-19T00:00:00.000Z');

test('isStalePublishingLock ignores non-publishing and Facebook-owned targets', () => {
  assert.equal(isStalePublishingLock({ status: 'scheduled' }, now), false);
  assert.equal(isStalePublishingLock({
    status: 'publishing',
    externalId: '123_456',
    publishingStartedAt: '2026-08-18T00:00:00.000Z',
  }, now), false);
});

test('isStalePublishingLock treats expired lease or old start as stale', () => {
  assert.equal(isStalePublishingLock({
    status: 'publishing',
    leaseExpiresAt: '2026-08-18T23:59:00.000Z',
  }, now), true);
  assert.equal(isStalePublishingLock({
    status: 'publishing',
    leaseExpiresAt: '2026-08-19T00:01:00.000Z',
  }, now), false);
  assert.equal(isStalePublishingLock({
    status: 'publishing',
    publishingStartedAt: new Date(now.getTime() - STALE_PUBLISHING_LOCK_MS).toISOString(),
  }, now), true);
  assert.equal(isStalePublishingLock({
    status: 'publishing',
    publishingStartedAt: new Date(now.getTime() - STALE_PUBLISHING_LOCK_MS + 1).toISOString(),
  }, now), false);
});

test('isStalePublishingLock treats legacy publishing rows without a timestamp as stale', () => {
  assert.equal(isStalePublishingLock({ status: 'publishing' }, now), true);
});
