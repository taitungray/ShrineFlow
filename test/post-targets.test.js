import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizePostStatus,
  migrateLegacyPost,
  resolveTargetCopy,
  resolveTargetMedia,
  normalizeTarget,
} from '../lib/post-targets.js';

test('summarizePostStatus: any scheduled wins over draft', () => {
  assert.equal(summarizePostStatus([
    { status: 'draft' },
    { status: 'scheduled' },
  ]), 'scheduled');
});

test('summarizePostStatus: all published', () => {
  assert.equal(summarizePostStatus([
    { status: 'published' },
    { status: 'published' },
  ]), 'published');
});

test('summarizePostStatus: partial success when published and failed targets coexist', () => {
  assert.equal(summarizePostStatus([
    { status: 'published' },
    { status: 'failed' },
  ]), 'partial_success');
});

test('summarizePostStatus: partial success when published and scheduled targets coexist', () => {
  assert.equal(summarizePostStatus([
    { status: 'published' },
    { status: 'scheduled' },
  ]), 'partial_success');
});

test('summarizePostStatus: failed when all targets fail without a published target', () => {
  assert.equal(summarizePostStatus([
    { status: 'failed' },
    { status: 'failed' },
  ]), 'failed');
});

test('summarizePostStatus: published with unsupported targets remains published', () => {
  assert.equal(summarizePostStatus([
    { status: 'published' },
    { status: 'skipped_unsupported' },
  ]), 'published');
});

test('summarizePostStatus: empty targets is draft', () => {
  assert.equal(summarizePostStatus([]), 'draft');
});

test('migrateLegacyPost wraps channel into single target', () => {
  const migrated = migrateLegacyPost({
    id: 'p1',
    channel: 'facebook',
    accountId: 'facebook:1',
    contentType: 'post',
    contentSettings: { layout: 'auto' },
    status: 'draft',
    facebook: 'hello',
  }, 'client_default');
  assert.equal(migrated.clientId, 'client_default');
  assert.equal(migrated.targets.length, 1);
  assert.equal(migrated.targets[0].platformId, 'facebook');
  assert.equal(migrated.targets[0].accountId, 'facebook:1');
  assert.equal(migrated.targets[0].contentSettings.layout, 'auto');
});

test('migrateLegacyPost keeps existing targets', () => {
  const migrated = migrateLegacyPost({
    id: 'p2',
    clientId: 'c1',
    targets: [{ id: 't1', platformId: 'instagram', accountId: 'instagram:x', status: 'draft' }],
  }, 'client_default');
  assert.equal(migrated.clientId, 'c1');
  assert.equal(migrated.targets[0].id, 't1');
});

test('migrateLegacyPost preserves archived lifecycle state', () => {
  const withTargets = migrateLegacyPost({
    id: 'archived-targets',
    status: 'archived',
    targets: [{ id: 't1', platformId: 'facebook', status: 'draft' }],
  });
  const legacy = migrateLegacyPost({
    id: 'archived-legacy',
    status: 'archived',
    channel: 'facebook',
  });
  assert.equal(withTargets.status, 'archived');
  assert.equal(legacy.status, 'archived');
  assert.equal(legacy.targets[0].status, 'draft');
});
test('resolveTargetCopy uses override when set', () => {
  const copy = resolveTargetCopy(
    { facebook: '母稿', reel: '' },
    { contentType: 'post', copyOverride: '覆寫' },
  );
  assert.equal(copy, '覆寫');
});

test('resolveTargetCopy falls back to facebook/reel mother copy', () => {
  assert.equal(resolveTargetCopy({ facebook: 'FB', reel: 'REEL' }, { contentType: 'post' }), 'FB');
  assert.equal(resolveTargetCopy({ facebook: 'FB', reel: 'REEL' }, { contentType: 'reel' }), 'REEL');
});

test('resolveTargetMedia prefers target mediaPaths', () => {
  assert.deepEqual(
    resolveTargetMedia({ mediaPaths: ['a.jpg'] }, { mediaPaths: ['b.jpg'] }),
    ['b.jpg'],
  );
  assert.deepEqual(
    resolveTargetMedia({ mediaPaths: ['a.jpg'], imagePath: 'old.jpg' }, { mediaPaths: null }),
    ['a.jpg'],
  );
});

test('normalizeTarget fills defaults', () => {
  const target = normalizeTarget({ accountId: 'facebook:1', platformId: 'facebook' });
  assert.ok(target.id);
  assert.equal(target.contentType, 'post');
  assert.equal(target.status, 'draft');
  assert.equal(target.copyOverride, null);
  assert.equal(target.mediaPaths, null);
  assert.equal(target.scheduleMode, 'manual');
  assert.equal(target.scheduleSource, null);
  assert.equal(target.pauseState, 'none');
  assert.equal(target.notificationState, 'none');
  assert.equal(target.delivery.firstComment.status, 'disabled');
});

test('normalizeTarget preserves queue, pause and child delivery metadata', () => {
  const target = normalizeTarget({
    accountId: 'instagram:1',
    platformId: 'instagram',
    scheduleMode: 'queue',
    scheduleSource: 'local',
    queueId: 'queue-1',
    queueSlotId: 'slot-1',
    queueSequence: 3,
    pauseState: 'paused',
    pauseReason: 'temporary stop',
    notificationState: 'notification_required',
    publishingStartedAt: '2026-08-18T12:00:00.000Z',
    leaseId: 'lease-1',
    leaseExpiresAt: '2026-08-18T12:05:00.000Z',
    delivery: {
      firstComment: { status: 'failed', text: '補充內容', lastError: { code: 'COMMENT_FAILED' } },
    },
  });
  assert.equal(target.scheduleMode, 'queue');
  assert.equal(target.publishingStartedAt, '2026-08-18T12:00:00.000Z');
  assert.equal(target.leaseId, 'lease-1');
  assert.equal(target.leaseExpiresAt, '2026-08-18T12:05:00.000Z');
  assert.equal(target.scheduleSource, 'local');
  assert.equal(target.queueSequence, 3);
  assert.equal(target.pauseState, 'paused');
  assert.equal(target.pauseReason, 'temporary stop');
  assert.equal(target.notificationState, 'notification_required');
  assert.equal(target.delivery.firstComment.status, 'failed');
  assert.equal(target.delivery.firstComment.text, '補充內容');
});
