import test from 'node:test';
import assert from 'node:assert/strict';

import {
  contentHash,
  decideRecordMerge,
  fingerprintCollection,
  mergeCollections,
  mergeSingletons,
  applyMergePlan,
  reencryptClientForTarget,
  rewriteMediaPathsInRecord,
} from '../lib/firestore-migration.js';

test('cloud-only records are kept and never deleted', () => {
  const plan = mergeCollections({
    name: 'posts',
    local: [{ id: 'local-1', updatedAt: '2026-08-01T00:00:00.000Z', title: 'A' }],
    remote: [
      { id: 'cloud-1', updatedAt: '2026-08-01T00:00:00.000Z', title: 'B' },
      { id: 'local-1', updatedAt: '2026-08-01T00:00:00.000Z', title: 'A' },
    ],
  });
  assert.equal(plan.decisions.find((item) => item.id === 'cloud-1')?.action, 'keep');
  assert.equal(plan.decisions.some((item) => item.action === 'delete'), false);
  assert.deepEqual(plan.summary, { create: 0, update: 0, keep: 2, conflict: 0 });
});

test('local-only records become create', () => {
  const plan = mergeCollections({
    name: 'posts',
    local: [{ id: 'local-1', updatedAt: '2026-08-01T00:00:00.000Z', title: 'A' }],
    remote: [],
  });
  assert.equal(plan.decisions[0].action, 'create');
  assert.equal(plan.summary.create, 1);
});

test('identical content is keep regardless of timestamps', () => {
  const record = { id: 'p1', updatedAt: '2026-08-02T00:00:00.000Z', title: 'Same' };
  const plan = mergeCollections({
    name: 'posts',
    local: [{ ...record, updatedAt: '2026-08-03T00:00:00.000Z' }],
    remote: [record],
  });
  assert.equal(plan.decisions[0].action, 'keep');
  assert.equal(contentHash(record), contentHash({ ...record, updatedAt: '2026-08-03T00:00:00.000Z' }));
});

test('newer local updatedAt wins as update', () => {
  const decision = decideRecordMerge({
    local: { id: 'p1', updatedAt: '2026-08-10T00:00:00.000Z', title: 'Local' },
    remote: { id: 'p1', updatedAt: '2026-08-01T00:00:00.000Z', title: 'Remote' },
  });
  assert.equal(decision.action, 'update');
  assert.equal(decision.record.title, 'Local');
});

test('newer remote updatedAt keeps remote', () => {
  const decision = decideRecordMerge({
    local: { id: 'p1', updatedAt: '2026-08-01T00:00:00.000Z', title: 'Local' },
    remote: { id: 'p1', updatedAt: '2026-08-10T00:00:00.000Z', title: 'Remote' },
  });
  assert.equal(decision.action, 'keep');
});

test('missing or equal timestamps with different content are blocking conflicts', () => {
  assert.equal(decideRecordMerge({
    local: { id: 'p1', title: 'Local' },
    remote: { id: 'p1', title: 'Remote' },
  }).action, 'conflict');
  assert.equal(decideRecordMerge({
    local: { id: 'p1', updatedAt: 'not-a-date', title: 'Local' },
    remote: { id: 'p1', updatedAt: '2026-08-01T00:00:00.000Z', title: 'Remote' },
  }).action, 'conflict');
  assert.equal(decideRecordMerge({
    local: { id: 'p1', updatedAt: '2026-08-01T00:00:00.000Z', title: 'Local' },
    remote: { id: 'p1', updatedAt: '2026-08-01T00:00:00.000Z', title: 'Remote' },
  }).action, 'conflict');
});

test('createdAt is used when updatedAt is absent', () => {
  const decision = decideRecordMerge({
    local: { id: 'p1', createdAt: '2026-08-10T00:00:00.000Z', title: 'Local' },
    remote: { id: 'p1', createdAt: '2026-08-01T00:00:00.000Z', title: 'Remote' },
  });
  assert.equal(decision.action, 'update');
});

test('singleton collections merge keys without deleting remote-only keys', () => {
  const plan = mergeSingletons({
    name: 'notifications',
    local: { version: 1, items: [{ id: 'n1' }] },
    remote: { version: 1, items: [{ id: 'n2' }], cursors: { a: 1 } },
    arrayKeys: ['items'],
  });
  assert.equal(plan.action, 'update');
  assert.equal(plan.record.items.length, 2);
  assert.deepEqual(plan.record.cursors, { a: 1 });
});

test('fingerprint changes reject apply', async () => {
  const remote = [{ id: 'p1', updatedAt: '2026-08-01T00:00:00.000Z', title: 'A' }];
  const plan = mergeCollections({
    name: 'posts',
    local: [{ id: 'p2', updatedAt: '2026-08-01T00:00:00.000Z', title: 'B' }],
    remote,
  });
  const fingerprint = fingerprintCollection(remote);
  let replaceCalls = 0;
  await assert.rejects(() => applyMergePlan({
    plan: { collections: [plan], remoteFingerprints: { posts: fingerprint } },
    loadRemote: async () => [{ id: 'p1', updatedAt: '2026-08-02T00:00:00.000Z', title: 'Changed' }],
    replaceRemote: async () => { replaceCalls += 1; },
  }), /fingerprint/i);
  assert.equal(replaceCalls, 0);
});

test('apply refuses plans that still have conflicts', async () => {
  const plan = mergeCollections({
    name: 'posts',
    local: [{ id: 'p1', title: 'Local' }],
    remote: [{ id: 'p1', title: 'Remote' }],
  });
  await assert.rejects(() => applyMergePlan({
    plan: { collections: [plan], remoteFingerprints: { posts: fingerprintCollection(plan.remote || []) } },
    loadRemote: async () => [{ id: 'p1', title: 'Remote' }],
    replaceRemote: async () => {},
  }), /conflict/i);
});

test('apply creates and updates while preserving untouched remote rows', async () => {
  const remote = [
    { id: 'keep', updatedAt: '2026-08-01T00:00:00.000Z', title: 'Keep' },
    { id: 'old', updatedAt: '2026-08-01T00:00:00.000Z', title: 'Old' },
  ];
  const plan = mergeCollections({
    name: 'posts',
    local: [
      { id: 'new', updatedAt: '2026-08-01T00:00:00.000Z', title: 'New' },
      { id: 'old', updatedAt: '2026-08-10T00:00:00.000Z', title: 'Updated' },
    ],
    remote,
  });
  let written;
  await applyMergePlan({
    plan: {
      collections: [plan],
      remoteFingerprints: { posts: fingerprintCollection(remote) },
    },
    loadRemote: async () => remote,
    replaceRemote: async (_name, value) => { written = value; },
  });
  assert.equal(written.length, 3);
  assert.equal(written.find((item) => item.id === 'old').title, 'Updated');
  assert.ok(written.find((item) => item.id === 'new'));
  assert.ok(written.find((item) => item.id === 'keep'));
});

test('media path rewriting uses mapping and reports missing sources', () => {
  const mapping = new Map([['/uploads/a.jpg', '/media/legacy/a.jpg']]);
  const result = rewriteMediaPathsInRecord({
    imagePath: '/uploads/a.jpg',
    mediaPaths: ['/uploads/a.jpg', '/uploads/missing.jpg'],
    targets: [{ mediaPaths: ['/uploads/a.jpg'] }],
  }, mapping);
  assert.equal(result.record.imagePath, '/media/legacy/a.jpg');
  assert.deepEqual(result.missing, ['/uploads/missing.jpg']);
});

test('client secrets are re-encrypted with target master key', () => {
  const sourceKey = 'source-master-key-aaaaaaaaaaaaaaaa';
  const targetKey = 'target-master-key-bbbbbbbbbbbbbbbb';
  const client = {
    id: 'client-1',
    accounts: [{
      id: 'facebook:1',
      credentials: { pageAccessToken: 'plain-token', pageId: '123' },
    }],
  };
  const migrated = reencryptClientForTarget(client, { sourceKey, targetKey });
  assert.match(migrated.accounts[0].credentials.pageAccessToken, /^enc:v1:/);
  assert.notEqual(
    migrated.accounts[0].credentials.pageAccessToken,
    client.accounts[0].credentials.pageAccessToken,
  );
});

test('history-style records merge by stable id without deleting remote-only events', () => {
  const plan = mergeCollections({
    name: 'publishAttempts',
    local: [{ id: 'evt-local', occurredAt: '2026-08-10T00:00:00.000Z', status: 'failed' }],
    remote: [{ id: 'evt-remote', occurredAt: '2026-08-01T00:00:00.000Z', status: 'published' }],
  });
  assert.equal(plan.summary.create, 1);
  assert.equal(plan.summary.keep, 1);
  assert.equal(plan.decisions.some((item) => item.action === 'delete'), false);
});
