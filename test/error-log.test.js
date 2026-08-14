import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { appendErrorLog, ERROR_LOG_RETENTION_POLICY, listErrorLogs } from '../lib/error-log.js';
import { jsonFiles, writeJson } from '../lib/store.js';

test('error log keeps bounded safe metadata and truncates old entries', async () => {
  const originalPath = jsonFiles.errorLog;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-error-log-'));
  jsonFiles.errorLog = path.join(temporaryDirectory, 'error-log.json');
  try {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await writeJson(jsonFiles.errorLog, {
      version: 1,
      items: Array.from({ length: ERROR_LOG_RETENTION_POLICY.maxItems }, (_, index) => ({
        id: `old-${index}`,
        createdAt: old,
        scope: 'old',
      })),
    });
    await appendErrorLog({
      scope: 'http',
      method: 'GET',
      path: '/api/system/health',
      status: 429,
      error: new Error('access_token=super-secret provider limit'),
    });
    const entries = await listErrorLogs({ limit: 50 });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, 429);
    assert.equal(entries[0].message.includes('super-secret'), false);
    assert.equal(entries[0].message.includes('[REDACTED]'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(entries[0], 'stack'), false);
  } finally {
    jsonFiles.errorLog = originalPath;
  }
});
