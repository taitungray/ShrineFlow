import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { persistUploadedFiles } from '../lib/upload.js';

function checksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function memoryMediaRepo(initial = []) {
  const assets = initial.map((item) => ({ ...item }));
  return {
    async list() {
      return assets.map((item) => ({ ...item }));
    },
    async getById(id) {
      return assets.find((item) => item.id === id) || null;
    },
    async mutate(mutator) {
      return mutator(assets);
    },
  };
}

test('persistUploadedFiles reuses a ready asset with the same checksum and deletes the new file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-upload-dedup-'));
  const bytes = Buffer.from('same-photo-bytes');
  const digest = checksum(bytes);
  const incomingPath = path.join(tempDir, '1750000000000-altar.jpg');
  await fs.writeFile(incomingPath, bytes);
  const repositories = {
    mediaAssets: memoryMediaRepo([{
      id: 'asset-altar',
      clientId: 'brand-a',
      mediaPath: '/uploads/altar.jpg',
      originalName: 'altar.jpg',
      mimeType: 'image/jpeg',
      status: 'ready',
      checksumSha256: digest,
    }]),
  };

  const persisted = await persistUploadedFiles([{
    originalname: 'altar.jpg',
    mimetype: 'image/jpeg',
    size: bytes.length,
    filename: '1750000000000-altar.jpg',
    path: incomingPath,
  }], {
    clientId: 'brand-a',
    repositories,
    mediaStorage: { backend: 'local-filesystem' },
  });

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].reused, true);
  assert.equal(persisted[0].mediaPath, '/uploads/altar.jpg');
  assert.equal(persisted[0].mediaId, 'asset-altar');
  await assert.rejects(fs.access(incomingPath));
  const assets = await repositories.mediaAssets.list();
  assert.equal(assets.length, 1);
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('persistUploadedFiles stores checksum on a new local upload', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-upload-new-'));
  const bytes = Buffer.from('brand-new-photo');
  const incomingPath = path.join(tempDir, '1750000000001-new.jpg');
  await fs.writeFile(incomingPath, bytes);
  const repositories = { mediaAssets: memoryMediaRepo() };

  const persisted = await persistUploadedFiles([{
    originalname: 'new.jpg',
    mimetype: 'image/jpeg',
    size: bytes.length,
    filename: '1750000000001-new.jpg',
    path: incomingPath,
  }], {
    clientId: 'brand-a',
    repositories,
    mediaStorage: { backend: 'local-filesystem' },
  });

  assert.equal(persisted[0].reused, undefined);
  assert.equal(persisted[0].mediaPath, '/uploads/1750000000001-new.jpg');
  assert.equal(persisted[0].checksumSha256, checksum(bytes));
  const assets = await repositories.mediaAssets.list();
  assert.equal(assets.length, 1);
  assert.equal(assets[0].checksumSha256, checksum(bytes));
  await fs.access(incomingPath);
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('persistUploadedFiles reuses the first file when the same bytes arrive twice', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-upload-batch-'));
  const bytes = Buffer.from('batch-twin');
  const firstPath = path.join(tempDir, '1-twin.jpg');
  const secondPath = path.join(tempDir, '2-twin.jpg');
  await fs.writeFile(firstPath, bytes);
  await fs.writeFile(secondPath, bytes);
  const repositories = { mediaAssets: memoryMediaRepo() };

  const persisted = await persistUploadedFiles([
    {
      originalname: 'a.jpg',
      mimetype: 'image/jpeg',
      size: bytes.length,
      filename: '1-twin.jpg',
      path: firstPath,
    },
    {
      originalname: 'b.jpg',
      mimetype: 'image/jpeg',
      size: bytes.length,
      filename: '2-twin.jpg',
      path: secondPath,
    },
  ], {
    clientId: 'brand-a',
    repositories,
    mediaStorage: { backend: 'local-filesystem' },
  });

  assert.equal(persisted[0].mediaPath, '/uploads/1-twin.jpg');
  assert.equal(persisted[1].reused, true);
  assert.equal(persisted[1].mediaPath, persisted[0].mediaPath);
  await assert.rejects(fs.access(secondPath));
  assert.equal((await repositories.mediaAssets.list()).length, 1);
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('persistUploadedFiles does not reuse another brand\'s matching file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-upload-brand-'));
  const bytes = Buffer.from('shared-looking-photo');
  const incomingPath = path.join(tempDir, 'other.jpg');
  await fs.writeFile(incomingPath, bytes);
  const repositories = {
    mediaAssets: memoryMediaRepo([{
      id: 'other-brand',
      clientId: 'brand-b',
      mediaPath: '/uploads/other.jpg',
      status: 'ready',
      checksumSha256: checksum(bytes),
    }]),
  };

  const persisted = await persistUploadedFiles([{
    originalname: 'photo.jpg',
    mimetype: 'image/jpeg',
    size: bytes.length,
    filename: 'other.jpg',
    path: incomingPath,
  }], {
    clientId: 'brand-a',
    repositories,
    mediaStorage: { backend: 'local-filesystem' },
  });

  assert.notEqual(persisted[0].mediaId, 'other-brand');
  assert.equal(persisted[0].reused, undefined);
  await fs.rm(tempDir, { recursive: true, force: true });
});
