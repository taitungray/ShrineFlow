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

test('summarizePostStatus: failed when any failed and none pending', () => {
  assert.equal(summarizePostStatus([
    { status: 'published' },
    { status: 'failed' },
  ]), 'failed');
});

test('summarizePostStatus: mixed published+scheduled stays scheduled', () => {
  assert.equal(summarizePostStatus([
    { status: 'published' },
    { status: 'scheduled' },
  ]), 'scheduled');
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
});
