import test from 'node:test';
import assert from 'node:assert/strict';

import { previewMediaSrc } from '../public/modules/media-preview.js';

test('browser preview uses authenticated media proxy instead of PUBLIC_MEDIA_BASE_URL', () => {
  assert.equal(
    previewMediaSrc('/uploads/20260815_073714.jpg'),
    '/api/media/preview?path=' + encodeURIComponent('/uploads/20260815_073714.jpg'),
  );
  assert.equal(
    previewMediaSrc('/media/original/client/2026/08/id/file_00000000552c8209a297b3886c5b8e9'),
    '/api/media/preview?path=' + encodeURIComponent('/media/original/client/2026/08/id/file_00000000552c8209a297b3886c5b8e9'),
  );
  assert.equal(previewMediaSrc('blob:http://localhost/abc'), 'blob:http://localhost/abc');
  assert.equal(previewMediaSrc('https://cdn.example/photo.jpg'), 'https://cdn.example/photo.jpg');
  assert.equal(previewMediaSrc(''), '');
});
