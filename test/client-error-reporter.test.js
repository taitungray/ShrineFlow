import assert from 'node:assert/strict';
import test from 'node:test';

import { formatClientErrorDetail, shouldIgnoreClientErrorUrl } from '../public/modules/client-error-reporter.js';

test('client error reporter ignores extensions and its own ingest paths', () => {
  assert.equal(shouldIgnoreClientErrorUrl('chrome-extension://abc/script.js'), true);
  assert.equal(shouldIgnoreClientErrorUrl('moz-extension://abc/script.js'), true);
  assert.equal(shouldIgnoreClientErrorUrl('/api/system/client-errors'), true);
  assert.equal(shouldIgnoreClientErrorUrl('https://shrineflow.example/api/system/error-log'), true);
  assert.equal(shouldIgnoreClientErrorUrl('https://shrineflow.example/api/system/error-log/export'), true);
  assert.equal(shouldIgnoreClientErrorUrl('/favicon.ico'), false);
  assert.equal(shouldIgnoreClientErrorUrl('/api/posts'), false);
});

test('client js errors keep file, line and stack in detail', () => {
  const detail = formatClientErrorDetail({
    filename: '/modules/drafts.js',
    lineno: 348,
    colno: 64,
    error: {
      name: 'ReferenceError',
      message: 'restoreRecoverySnapshotForPost is not defined',
      stack: 'ReferenceError: restoreRecoverySnapshotForPost is not defined\n    at loadPost (drafts.js:348:64)',
    },
  });
  assert.match(detail, /file: \/modules\/drafts\.js/);
  assert.match(detail, /line: 348/);
  assert.match(detail, /col: 64/);
  assert.match(detail, /at loadPost \(drafts\.js:348:64\)/);
});
