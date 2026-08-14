import assert from 'node:assert/strict';
import test from 'node:test';

import { createR2MediaStorage } from '../lib/r2-storage.js';

const fixedNow = Date.parse('2026-08-14T12:34:56.000Z');

function createStorage(fetchImpl = async () => ({ ok: true, status: 200 })) {
  return createR2MediaStorage({
    accountId: 'account-123',
    bucket: 'shrineflow-media',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    publicBaseUrl: 'https://cdn.example.test',
    now: () => fixedNow,
    fetchImpl,
  });
}

test('R2 media storage creates safe, expiring presigned upload sessions', () => {
  const storage = createStorage();
  const session = storage.createUploadSession({
    clientId: 'client/one',
    originalName: '..\\temple photo.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1234,
  });

  assert.equal(storage.backend, 'r2');
  assert.match(session.mediaPath, /^\/media\/original\/one\/2026\/08\//);
  assert.match(session.objectKey, /temple_photo\.jpg$/);
  assert.equal(session.headers['Content-Type'], 'image/jpeg');
  const url = new URL(session.uploadUrl);
  assert.equal(url.hostname, 'account-123.r2.cloudflarestorage.com');
  assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
});

test('R2 media paths resolve to a public CDN URL without exposing credentials', () => {
  const storage = createStorage();
  assert.equal(
    storage.resolvePublicUrl('/media/original/client/2026/08/media/photo.jpg'),
    'https://cdn.example.test/media/original/client/2026/08/media/photo.jpg',
  );
  assert.equal(storage.resolvePublicUrl('/media/../secret.txt'), null);
  assert.equal(storage.getObjectKey('/uploads/legacy.jpg'), 'legacy/legacy.jpg');
});

test('R2 media storage performs signed object requests', async () => {
  const calls = [];
  const storage = createStorage(async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '12', 'content-type': 'image/jpeg', etag: 'etag-1' }),
      async arrayBuffer() {
        return Uint8Array.from([1, 2, 3]).buffer;
      },
    };
  });

  await storage.putBuffer('original/client/photo.jpg', Buffer.from('hello'), { contentType: 'image/jpeg' });
  assert.deepEqual(await storage.headObject('original/client/photo.jpg'), {
    sizeBytes: 12,
    contentType: 'image/jpeg',
    etag: 'etag-1',
  });
  assert.deepEqual(await storage.getBuffer('/media/original/client/photo.jpg'), Buffer.from([1, 2, 3]));
  assert.equal(await storage.delete('/media/original/client/photo.jpg'), true);
  assert.deepEqual(calls.map((call) => call.options.method), ['PUT', 'HEAD', 'GET', 'DELETE']);
  calls.forEach((call) => assert.match(call.url, /X-Amz-Signature=/));
});
