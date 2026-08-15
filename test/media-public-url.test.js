import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublicMediaUrl, resolvePublicMediaUrls } from '../lib/media-public-url.js';

test('joins PUBLIC_MEDIA_BASE_URL with upload path', () => {
  assert.equal(
    resolvePublicMediaUrl('/uploads/a.jpg', 'https://tunnel.example'),
    'https://tunnel.example/uploads/a.jpg',
  );
});

test('rejects missing base url', () => {
  assert.throws(() => resolvePublicMediaUrl('/uploads/a.jpg', ''), /PUBLIC_MEDIA_BASE_URL|公開/);
});

test('strips trailing slash on base', () => {
  assert.equal(
    resolvePublicMediaUrl('/uploads/a.jpg', 'https://tunnel.example/'),
    'https://tunnel.example/uploads/a.jpg',
  );
});

test('rejects invalid non-uploads path', () => {
  assert.throws(
    () => resolvePublicMediaUrl('/static/a.jpg', 'https://tunnel.example'),
    /媒體路徑無效/,
  );
});

test('joins public base url with R2 media path', () => {
  assert.equal(
    resolvePublicMediaUrl('/media/original/client/2026/08/id/photo.jpg', 'https://cdn.example.test'),
    'https://cdn.example.test/media/original/client/2026/08/id/photo.jpg',
  );
});

test('resolvePublicMediaUrls maps each upload path', () => {
  assert.deepEqual(
    resolvePublicMediaUrls(
      ['/uploads/a.jpg', '/uploads/b.png'],
      'https://tunnel.example',
    ),
    [
      'https://tunnel.example/uploads/a.jpg',
      'https://tunnel.example/uploads/b.png',
    ],
  );
});
