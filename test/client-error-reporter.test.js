import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldIgnoreClientErrorUrl } from '../public/modules/client-error-reporter.js';

test('client error reporter ignores extensions and its own ingest paths', () => {
  assert.equal(shouldIgnoreClientErrorUrl('chrome-extension://abc/script.js'), true);
  assert.equal(shouldIgnoreClientErrorUrl('moz-extension://abc/script.js'), true);
  assert.equal(shouldIgnoreClientErrorUrl('/api/system/client-errors'), true);
  assert.equal(shouldIgnoreClientErrorUrl('https://shrineflow.example/api/system/error-log'), true);
  assert.equal(shouldIgnoreClientErrorUrl('https://shrineflow.example/api/system/error-log/export'), true);
  assert.equal(shouldIgnoreClientErrorUrl('/favicon.ico'), false);
  assert.equal(shouldIgnoreClientErrorUrl('/api/posts'), false);
});
