import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COLLECTION_STORAGE_POLICY,
  StorageLimitError,
  assertCollectionCapacity,
  assertNestedCollectionCapacity,
  countStoredItems,
  getJsonStoragePolicy,
  serializeJsonWithinLimit,
} from '../lib/storage-policy.js';

test('storage policy rejects collection growth beyond hard limits', () => {
  assert.doesNotThrow(() => assertCollectionCapacity('posts', COLLECTION_STORAGE_POLICY.posts.maxItems - 1, 1));
  assert.throws(
    () => assertCollectionCapacity('posts', COLLECTION_STORAGE_POLICY.posts.maxItems, 1),
    (error) => error instanceof StorageLimitError && error.code === 'STORAGE_LIMIT_REACHED' && error.status === 409,
  );
  assert.throws(
    () => assertNestedCollectionCapacity('clients', COLLECTION_STORAGE_POLICY.clients.maxAccountsPerClient, 1),
    (error) => error instanceof StorageLimitError && error.code === 'STORAGE_NESTED_LIMIT_REACHED',
  );
});

test('storage policy exposes bounded JSON size and collection usage', () => {
  assert.equal(getJsonStoragePolicy('data/posts.json').maxBytes, 64 * 1024 * 1024);
  const serialized = serializeJsonWithinLimit('data/posts.json', [{ id: 'post-1' }]);
  assert.equal(serialized.bytes, Buffer.byteLength(serialized.serialized, 'utf8'));
  assert.equal(countStoredItems('notifications', { version: 1, items: [{ id: 'n-1' }] }), 1);
  assert.equal(countStoredItems('inboxMetadata', { items: { a: {} }, cursors: { b: {} }, syncHints: {} }), 2);
});
