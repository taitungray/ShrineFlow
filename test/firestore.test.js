import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFirestoreClient,
  decodeFirestoreDocument,
  encodeFirestoreDocument,
} from '../lib/firestore-rest.js';
import { RepositoryConflictError, createFirestoreRepositories } from '../lib/repositories.js';

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test('Firestore value conversion preserves nested JSON values', () => {
  const source = {
    id: 'post-1',
    title: 'hello',
    count: 2,
    enabled: true,
    tags: ['a', 'b'],
    nested: { published: null },
  };
  const document = encodeFirestoreDocument(source, 'projects/demo/databases/(default)/documents/posts/post-1');
  const restored = decodeFirestoreDocument(document);
  assert.deepEqual(restored, source);
  assert.equal(document.fields.count.integerValue, '2');
  assert.equal(document.fields.nested.mapValue.fields.published.nullValue, 'NULL_VALUE');
});

test('Firestore REST client adds the bearer token and paginates documents', async () => {
  const calls = [];
  const client = createFirestoreClient({
    env: {
      FIRESTORE_PROJECT_ID: 'demo',
      FIRESTORE_DATABASE_ID: '(default)',
      SHRINEFLOW_FIRESTORE_ACCESS_TOKEN: 'test-token',
    },
    apiBaseUrl: 'https://firestore.test/v1',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({
        documents: [{ name: 'projects/demo/databases/(default)/documents/posts/post-1', fields: {} }],
        nextPageToken: '',
      });
    },
  });

  const documents = await client.listDocuments('posts');
  assert.equal(documents.length, 1);
  assert.match(calls[0].url, /projects%2Fdemo|projects\/demo/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
});

test('Firestore REST client builds structured equality queries', async () => {
  const calls = [];
  const client = createFirestoreClient({
    env: {
      FIRESTORE_PROJECT_ID: 'demo',
      SHRINEFLOW_FIRESTORE_ACCESS_TOKEN: 'test-token',
    },
    apiBaseUrl: 'https://firestore.test/v1',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response([{ document: {
        name: 'projects/demo/databases/(default)/documents/memberships/m-1',
        fields: { userId: { stringValue: 'user-1' } },
      } }]);
    },
  });
  const documents = await client.runQuery('memberships', {
    filters: { userId: 'user-1', status: 'active' },
    orderBy: 'createdAt',
    direction: 'desc',
    limit: 20,
  });
  assert.equal(documents.length, 1);
  assert.match(calls[0].url, /:runQuery$/);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.structuredQuery.where.compositeFilter.filters.length, 2);
  assert.equal(body.structuredQuery.orderBy[0].direction, 'DESCENDING');
  assert.equal(body.structuredQuery.limit, 20);
});

function createFakeFirestoreClient() {
  const documents = new Map();
  let transactionId = 0;
  const client = {
    backend: 'firestore',
    projectId: 'demo',
    databaseId: '(default)',
    documentIdFromName(name) {
      return decodeURIComponent(String(name).split('/').at(-1));
    },
    documentPath(collection, id) {
      return '/' + collection + '/' + encodeURIComponent(id);
    },
    async listDocuments(collection) {
      return [...documents.values()].filter((document) => document.name.includes('/documents/' + collection + '/'));
    },
    async beginTransaction() {
      transactionId += 1;
      return 'tx-' + transactionId;
    },
    async commit(writes) {
      for (const write of writes) {
        if (write.delete) documents.delete(write.delete);
        if (write.update) documents.set(write.update.name, write.update);
      }
      return {};
    },
    async getDocument(collection, id) {
      return documents.get('projects/demo/databases/(default)/documents/' + collection + '/' + id) || null;
    },
  };
  return client;
}

test('Firestore repositories keep array and singleton collection shapes', async () => {
  const repositories = createFirestoreRepositories({ client: createFakeFirestoreClient() });
  await repositories.posts.mutate((posts) => {
    posts.push({ id: 'post-1', status: 'draft', targets: [] });
    return posts.length;
  });
  assert.deepEqual(await repositories.posts.getById('post-1'), {
    id: 'post-1',
    status: 'draft',
    targets: [],
  });

  await repositories.notifications.mutate((record) => {
    record.items.push({ id: 'notice-1', readAt: null });
    return record.items.length;
  });
  assert.deepEqual(await repositories.notifications.list(), {
    id: 'state',
    version: 1,
    items: [{ id: 'notice-1', readAt: null }],
  });
});

test('Firestore repositories support document create, query, optimistic update and delete', async () => {
  const repositories = createFirestoreRepositories({ client: createFakeFirestoreClient() });
  await repositories.users.create({ id: 'user-1', email: 'one@example.com', version: 1, status: 'active' });
  await repositories.users.create({ id: 'user-2', email: 'two@example.com', version: 1, status: 'suspended' });
  assert.equal((await repositories.users.query({ filters: { status: 'active' } })).length, 1);
  const updated = await repositories.users.update('user-1', { displayName: 'One', version: 2 }, { expectedVersion: 1 });
  assert.equal(updated.displayName, 'One');
  await assert.rejects(
    () => repositories.users.update('user-1', { displayName: 'Stale' }, { expectedVersion: 1 }),
    (error) => error instanceof RepositoryConflictError && error.status === 409,
  );
  assert.equal(await repositories.users.deleteById('user-2'), true);
  assert.equal(await repositories.users.getById('user-2'), null);
});
