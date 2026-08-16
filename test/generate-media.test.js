import test from 'node:test';
import assert from 'node:assert/strict';

import { assembleGenerateMedia } from '../lib/generate-media.js';

const assets = [
  {
    id: 'asset-photo',
    clientId: 'brand-a',
    mediaPath: '/uploads/altar.jpg',
    originalName: 'altar.jpg',
    mimeType: 'image/jpeg',
    status: 'ready',
  },
  {
    id: 'asset-video',
    clientId: 'brand-a',
    mediaPath: '/uploads/rite.mp4',
    originalName: 'rite.mp4',
    mimeType: 'video/mp4',
    status: 'ready',
  },
];

test('assembleGenerateMedia follows mixed library and upload sequence', () => {
  const uploaded = [{ mediaPath: '/uploads/new.jpg', originalname: 'new.jpg', mimetype: 'image/jpeg' }];
  const result = assembleGenerateMedia({
    uploaded,
    sequence: [
      { kind: 'library', mediaPath: '/uploads/altar.jpg' },
      { kind: 'upload', index: 0 },
      { kind: 'library', mediaId: 'asset-video' },
    ],
    assets,
    clientId: 'brand-a',
  });
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.mediaPaths, ['/uploads/altar.jpg', '/uploads/new.jpg', '/uploads/rite.mp4']);
  assert.equal(result.items[0].source, 'library');
  assert.equal(result.items[1].source, 'upload');
});

test('assembleGenerateMedia rejects other-brand or not-ready library assets', () => {
  const result = assembleGenerateMedia({
    uploaded: [],
    sequence: [{ kind: 'library', mediaPath: '/uploads/other.jpg' }],
    assets: [{ ...assets[0], clientId: 'brand-b', mediaPath: '/uploads/other.jpg' }],
    clientId: 'brand-a',
  });
  assert.equal(result.errors[0].code, 'MEDIA_REFERENCE_NOT_FOUND');
  assert.deepEqual(result.mediaPaths, []);
});

test('assembleGenerateMedia without sequence keeps uploaded files then existing paths', () => {
  const result = assembleGenerateMedia({
    uploaded: [{ mediaPath: '/uploads/new.jpg' }],
    existingMediaPaths: ['/uploads/altar.jpg'],
    assets,
    clientId: 'brand-a',
  });
  assert.deepEqual(result.mediaPaths, ['/uploads/altar.jpg', '/uploads/new.jpg']);
});
