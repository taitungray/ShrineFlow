import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFirestoreClient,
  decodeFirestoreDocument,
  encodeFirestoreDocument,
} from '../lib/firestore-rest.js';
import { createFirestoreRepositories } from '../lib/repositories.js';

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
