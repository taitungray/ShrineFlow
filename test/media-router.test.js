import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { createLocalMediaStorage } from '../lib/media-storage.js';
import { createMediaRouter } from '../lib/routes/media.js';

function startApp(mediaStorage) {
  const app = express();
  app.use('/api', createMediaRouter({ mediaStorage, repositories: { mediaAssets: { async list() { return []; }, async getById() { return null; } } } }));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  return { server, baseUrl };
}

test('media preview redirects R2 paths to a short-lived GET URL', async () => {
  const mediaStorage = {
    backend: 'r2',
    createPresignedGetUrl(mediaPath) {
      assert.equal(mediaPath, '/media/original/client/2026/08/id/photo.jpg');
      return 'https://signed.example.test/photo.jpg?X-Amz-Signature=abc';
    },
  };
  const { server, baseUrl } = startApp(mediaStorage);
  try {
    const response = await fetch(`${baseUrl}/media/preview?path=${encodeURIComponent('/media/original/client/2026/08/id/photo.jpg')}`, {
      redirect: 'manual',
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://signed.example.test/photo.jpg?X-Amz-Signature=abc');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('media preview serves local upload files by path', async () => {
  const uploadsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-media-preview-'));
  await fs.writeFile(path.join(uploadsDirectory, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const { server, baseUrl } = startApp(createLocalMediaStorage({ uploadsDirectory }));
  try {
    const response = await fetch(`${baseUrl}/media/preview?path=${encodeURIComponent('/uploads/photo.jpg')}`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(uploadsDirectory, { recursive: true, force: true });
  }
});

test('media preview rejects path traversal', async () => {
  const { server, baseUrl } = startApp(createLocalMediaStorage());
  try {
    const response = await fetch(`${baseUrl}/media/preview?path=${encodeURIComponent('/uploads/../.env')}`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'MEDIA_PATH_INVALID');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
