import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_MEDIA_ITEMS,
  collectPickerAssets,
  filterPickerAssets,
  mediaItemFromAsset,
  mergeSelectedMedia,
  buildGenerateMediaPayload,
  seedSelectedMedia,
} from '../public/modules/media-picker.js';

const readyPhoto = {
  id: 'asset-photo',
  clientId: 'brand-a',
  mediaPath: '/uploads/altar.jpg',
  originalName: 'altar.jpg',
  mimeType: 'image/jpeg',
  status: 'ready',
  createdAt: '2026-08-16T10:00:00.000Z',
};

const readyVideo = {
  id: 'asset-video',
  clientId: 'brand-a',
  mediaPath: '/uploads/rite.mp4',
  originalName: 'rite.mp4',
  mimeType: 'video/mp4',
  status: 'ready',
  createdAt: '2026-08-16T09:00:00.000Z',
};

test('collectPickerAssets keeps current brand ready assets and post-only paths, newest first', () => {
  const assets = collectPickerAssets({
    assets: [
      readyPhoto,
      readyVideo,
      { ...readyPhoto, id: 'pending', status: 'pending', mediaPath: '/uploads/pending.jpg' },
      { ...readyPhoto, id: 'other', clientId: 'brand-b', mediaPath: '/uploads/other.jpg' },
    ],
    posts: [
      { clientId: 'brand-a', mediaPaths: ['/uploads/legacy.png'], updatedAt: '2026-08-16T11:00:00.000Z' },
      { clientId: 'brand-b', mediaPaths: ['/uploads/skip.jpg'] },
    ],
    clientId: 'brand-a',
  });
  assert.deepEqual(assets.map((item) => item.mediaPath), [
    '/uploads/legacy.png',
    '/uploads/altar.jpg',
    '/uploads/rite.mp4',
  ]);
  assert.equal(assets[0].id, '');
  assert.equal(assets[1].id, 'asset-photo');
});

test('filterPickerAssets matches name and type', () => {
  const items = collectPickerAssets({ assets: [readyPhoto, readyVideo], clientId: 'brand-a' });
  assert.deepEqual(filterPickerAssets(items, { type: 'video' }).map((item) => item.id), ['asset-video']);
  assert.deepEqual(filterPickerAssets(items, { query: 'altar' }).map((item) => item.id), ['asset-photo']);
});

test('mergeSelectedMedia appends library items, skips duplicates, and stops at 10', () => {
  const current = [mediaItemFromAsset(readyPhoto)];
  const incoming = [
    mediaItemFromAsset(readyPhoto),
    mediaItemFromAsset(readyVideo),
    ...Array.from({ length: 10 }, (_item, index) => mediaItemFromAsset({
      id: 'extra-' + index,
      mediaPath: '/uploads/extra-' + index + '.jpg',
      originalName: 'extra-' + index + '.jpg',
      mimeType: 'image/jpeg',
    })),
  ];
  const result = mergeSelectedMedia(current, incoming, { max: MAX_MEDIA_ITEMS });
  assert.equal(result.items.length, 10);
  assert.equal(result.skippedDuplicate, 1);
  assert.equal(result.skippedLimit, 2);
  assert.equal(result.items[1].serverPath, '/uploads/rite.mp4');
  assert.equal(result.items[0].kind, 'library');
});

test('seedSelectedMedia fills empty composer list from existing paths', () => {
  assert.deepEqual(seedSelectedMedia([], ['/uploads/altar.jpg']).map((item) => item.serverPath), ['/uploads/altar.jpg']);
  const current = [mediaItemFromAsset(readyPhoto)];
  assert.equal(seedSelectedMedia(current, ['/uploads/other.jpg']), current);
});

test('buildGenerateMediaPayload keeps mixed library and upload order', () => {
  const file = { name: 'new.jpg', type: 'image/jpeg', size: 12 };
  const payload = buildGenerateMediaPayload([
    mediaItemFromAsset(readyPhoto),
    { kind: 'file', file, source: 'blob:1', type: 'image/jpeg', name: 'new.jpg' },
    mediaItemFromAsset(readyVideo),
  ]);
  assert.deepEqual(payload.files, [file]);
  assert.deepEqual(payload.sequence, [
    { kind: 'library', mediaPath: '/uploads/altar.jpg', mediaId: 'asset-photo' },
    { kind: 'upload', index: 0 },
    { kind: 'library', mediaPath: '/uploads/rite.mp4', mediaId: 'asset-video' },
  ]);
});
