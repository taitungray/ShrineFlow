import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendErrorLog,
  CLIENT_ERROR_SCOPES,
  ERROR_LOG_RETENTION_POLICY,
  errorFingerprint,
  exportErrorLogs,
  ingestClientError,
  listErrorLogs,
  resolveErrorLog,
  shouldRecordHttpError,
} from '../lib/error-log.js';
import { jsonFiles, writeJson } from '../lib/store.js';

async function withTempErrorLog(run) {
  const originalPath = jsonFiles.errorLog;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-error-log-'));
  jsonFiles.errorLog = path.join(temporaryDirectory, 'error-log.json');
  try {
    await writeJson(jsonFiles.errorLog, { version: 1, items: [] });
    await run();
  } finally {
    jsonFiles.errorLog = originalPath;
  }
}

test('error log keeps bounded safe metadata and truncates old entries', async () => {
  await withTempErrorLog(async () => {
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
    assert.equal(entries[0].count, 1);
    assert.equal(entries[0].resolutionStatus, 'open');
  });
});

test('same fingerprint merges into one entry and increments count', async () => {
  await withTempErrorLog(async () => {
    const first = await appendErrorLog({
      scope: 'http',
      method: 'GET',
      path: '/favicon.ico',
      status: 404,
      message: 'Not Found',
    });
    const second = await appendErrorLog({
      scope: 'client_resource',
      method: 'GET',
      path: 'https://example.test/favicon.ico?cache=1',
      status: 404,
      message: 'Failed to load',
    });
    const entries = await listErrorLogs({ limit: 50 });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, first.id);
    assert.equal(entries[0].id, second.id);
    assert.equal(entries[0].count, 2);
    assert.equal(entries[0].fingerprint, errorFingerprint({
      method: 'GET',
      path: '/favicon.ico',
      status: 404,
      code: '',
    }));
    assert.ok(entries[0].lastSeenAt >= first.createdAt);
  });
});

test('resolved fingerprint reopens when it happens again', async () => {
  await withTempErrorLog(async () => {
    const first = await appendErrorLog({
      scope: 'client_js',
      message: 'boom at composer',
    });
    const resolved = await resolveErrorLog(first.id);
    assert.equal(resolved.resolutionStatus, 'fixed');
    assert.ok(resolved.resolvedAt);
    const openOnly = await listErrorLogs({ status: 'open' });
    const fixedOnly = await listErrorLogs({ status: 'fixed' });
    assert.equal(openOnly.length, 0);
    assert.equal(fixedOnly.length, 1);
    await appendErrorLog({
      scope: 'client_js',
      message: 'boom at composer',
    });
    const reopened = await listErrorLogs({ status: 'open' });
    assert.equal(reopened.length, 1);
    assert.equal(reopened[0].id, first.id);
    assert.equal(reopened[0].count, 2);
    assert.equal(reopened[0].resolutionStatus, 'open');
    assert.equal(reopened[0].resolvedAt, null);
  });
});

test('resolveErrorLog returns null when id is missing', async () => {
  await withTempErrorLog(async () => {
    assert.equal(await resolveErrorLog('missing'), null);
  });
});

test('shouldRecordHttpError keeps favicon 404 and drops probe noise', () => {
  assert.equal(shouldRecordHttpError(404, '/favicon.ico'), true);
  assert.equal(shouldRecordHttpError(503, '/api/system/readiness'), false);
  assert.equal(shouldRecordHttpError(503, '/system/readiness'), false);
  assert.equal(shouldRecordHttpError(401, '/api/auth/login'), false);
  assert.equal(shouldRecordHttpError(500, '/api/posts'), true);
  assert.equal(shouldRecordHttpError(200, '/api/posts'), false);
  assert.equal(shouldRecordHttpError(429, '/api/system/client-errors'), false);
});

test('ingestClientError rejects unknown scopes and exports redacted items', async () => {
  await withTempErrorLog(async () => {
    await assert.rejects(
      () => ingestClientError({ scope: 'console_dump', message: 'nope' }),
      (error) => error.status === 400,
    );
    assert.ok(CLIENT_ERROR_SCOPES.includes('client_js'));
    await ingestClientError({
      scope: 'client_network',
      method: 'POST',
      path: '/api/publish',
      status: 502,
      message: 'authorization=secret-token failed',
    }, { actorId: 'tester-export' });
    const exported = await exportErrorLogs({ status: 'open' });
    assert.equal(exported.version, 1);
    assert.equal(exported.items.length, 1);
    assert.equal(exported.items[0].message.includes('secret-token'), false);
    assert.equal(exported.items[0].source, 'client');
  });
});
