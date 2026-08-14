import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validatePostFormat,
  validateTargetFormat,
} from '../lib/content-validation.js';
import { normalizeTarget } from '../lib/post-targets.js';

test('validates platform text and media count limits', async () => {
  const report = await validateTargetFormat({
    platformId: 'threads',
    contentType: 'post',
    copy: 'a'.repeat(10001),
    mediaPaths: ['/uploads/photo.jpg'],
  });

  assert.equal(report.valid, false);
  assert.ok(report.errors.some((issue) => issue.code === 'text_too_long'));

  const longButSupported = await validateTargetFormat({
    platformId: 'threads',
    contentType: 'post',
    copy: 'a'.repeat(501),
  });
  assert.equal(longButSupported.valid, true);
  assert.ok(longButSupported.warnings.some((issue) => issue.code === 'text_over_recommended'));

  const tooManyImages = await validateTargetFormat({
    platformId: 'instagram',
    contentType: 'feed',
    copy: 'caption',
    mediaPaths: Array.from({ length: 11 }, (_item, index) => `/uploads/${index}.jpg`),
  });
  assert.equal(tooManyImages.valid, false);
  assert.ok(tooManyImages.errors.some((issue) => issue.code === 'media_count_exceeded'));
});

test('validates video duration and aspect ratio with injected metadata', async () => {
  const shortVideo = await validateTargetFormat({
    platformId: 'instagram',
    contentType: 'reel',
    copy: 'reel caption',
    mediaPaths: ['/uploads/reel.mp4'],
    uploadsDirectory: 'D:/uploads',
    probeMedia: async () => ({ kind: 'video', width: 1080, height: 1920, durationSeconds: 2 }),
  });

  assert.equal(shortVideo.valid, false);
  assert.ok(shortVideo.errors.some((issue) => issue.code === 'video_too_short'));

  const wideVideo = await validateTargetFormat({
    platformId: 'instagram',
    contentType: 'reel',
    copy: 'reel caption',
    mediaPaths: ['/uploads/reel.mp4'],
    uploadsDirectory: 'D:/uploads',
    probeMedia: async () => ({ kind: 'video', width: 1920, height: 1080, durationSeconds: 30 }),
  });

  assert.equal(wideVideo.valid, true);
  assert.ok(wideVideo.warnings.some((issue) => issue.code === 'video_ratio_recommended'));
});

test('rejects mixed Instagram carousel media and preserves unverified warnings', async () => {
  const mixed = await validateTargetFormat({
    platformId: 'instagram',
    contentType: 'feed',
    copy: 'caption',
    mediaPaths: ['/uploads/photo.jpg', '/uploads/video.mp4'],
  });
  assert.equal(mixed.valid, false);
  assert.ok(mixed.errors.some((issue) => issue.code === 'media_mix_not_allowed'));

  const unverified = await validateTargetFormat({
    platformId: 'instagram',
    contentType: 'reel',
    copy: 'caption',
    mediaPaths: ['/uploads/video.mp4'],
  });
  assert.equal(unverified.valid, true);
  assert.ok(unverified.warnings.some((issue) => issue.code === 'video_metadata_unverified'));
});

test('validates every saved target and caps target media paths', async () => {
  const report = await validatePostFormat({
    facebook: 'Facebook copy',
    reel: 'Reel copy',
    mediaPaths: ['/uploads/base.jpg'],
    targets: [{
      id: 'target-1',
      platformId: 'instagram',
      contentType: 'feed',
      mediaPaths: ['/uploads/photo.jpg'],
    }],
  });
  assert.equal(report.valid, true);
  assert.equal(report.targets.length, 1);

  const normalized = normalizeTarget({
    platformId: 'facebook',
    mediaPaths: Array.from({ length: 100 }, (_item, index) => `/uploads/${index}.jpg`),
  });
  assert.equal(normalized.mediaPaths.length, 20);
});
