import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildMediaMigrationPlan,
  applyMediaMigrationPlan,
} from '../lib/media-migration.js';
import { encryptSecret, decryptSecret } from '../lib/secret-storage.js';
import { reencryptClientForTarget } from '../lib/firestore-migration.js';

test('media plan dry-run maps uploads without writing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-media-'));
  const uploads = path.join(root, 'uploads');
  await fs.mkdir(uploads, { recursive: true });
  await fs.writeFile(path.join(uploads, 'a.jpg'), Buffer.from('image-a'));

  const putCalls = [];
  const plan = await buildMediaMigrationPlan({
    uploadsDirectory: uploads,
    mediaStorage: {
      bucket: 'bucket',
      getMediaPath: (key) => '/media/' + key,
      putBuffer: async (...args) => { putCalls.push(args); },
      headObject: async () => null,
    },
  });

  assert.equal(plan.files.length, 1);
  assert.equal(plan.files[0].oldPath, '/uploads/a.jpg');
  assert.match(plan.files[0].mediaPath, /^\/media\//);
  assert.equal(putCalls.length, 0);
});

test('media apply is idempotent when object already exists with same hash', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-media-'));
  const uploads = path.join(root, 'uploads');
  await fs.mkdir(uploads, { recursive: true });
  const buffer = Buffer.from('image-a');
  await fs.writeFile(path.join(uploads, 'a.jpg'), buffer);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  let putCount = 0;
  const mediaStorage = {
    bucket: 'bucket',
    getMediaPath: (key) => '/media/' + key,
    putBuffer: async () => { putCount += 1; },
    headObject: async () => ({ etag: `"${hash}"`, contentLength: buffer.length }),
  };
  const plan = await buildMediaMigrationPlan({ uploadsDirectory: uploads, mediaStorage });
  const assets = [];
  await applyMediaMigrationPlan({
    plan,
    mediaStorage,
    upsertAsset: async (asset) => { assets.push(asset); return asset; },
  });
  assert.equal(putCount, 0);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].checksumSha256, hash);
});

test('missing upload referenced by posts becomes media conflict', async () => {
  const plan = await buildMediaMigrationPlan({
    uploadsDirectory: path.join(os.tmpdir(), 'sf-missing-uploads-' + Date.now()),
    mediaStorage: {
      bucket: 'bucket',
      getMediaPath: (key) => '/media/' + key,
      putBuffer: async () => {},
      headObject: async () => null,
    },
    referencedPaths: ['/uploads/missing.jpg'],
  });
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].path, '/uploads/missing.jpg');
});

test('credential re-encryption round-trip preserves plaintext under target key', () => {
  const sourceKey = 'source-master-key-aaaaaaaaaaaaaaaa';
  const targetKey = 'target-master-key-bbbbbbbbbbbbbbbb';
  const client = {
    id: 'client-1',
    credentials: { pageAccessToken: encryptSecret('token-1', sourceKey) },
    accounts: [{
      id: 'instagram:1',
      credentials: { accessToken: encryptSecret('token-2', sourceKey) },
    }],
  };
  const migrated = reencryptClientForTarget(client, { sourceKey, targetKey });
  assert.equal(decryptSecret(migrated.credentials.pageAccessToken, targetKey), 'token-1');
  assert.equal(decryptSecret(migrated.accounts[0].credentials.accessToken, targetKey), 'token-2');
});
