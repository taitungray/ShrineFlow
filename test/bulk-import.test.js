import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { parseBulkCsv, validateBulkCsv } from '../lib/bulk-import.js';
import { createBulkImportRouter } from '../lib/routes/bulk-import.js';
import { directories } from '../lib/store.js';

test('bulk CSV parser supports quoted commas and maps supported aliases', () => {
  const parsed = parseBulkCsv([
    '主題,文案,平台,格式,素材',
    '"中元,提醒","先整理供桌",facebook,post,/uploads/a.jpg|/uploads/b.jpg',
  ].join('\n'));
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.headers, ['contentTopic', 'facebook', 'platform', 'contentType', 'mediaPaths']);
  assert.equal(parsed.rows[0].values.contentTopic, '中元,提醒');
  assert.equal(parsed.rows[0].values.mediaPaths, '/uploads/a.jpg|/uploads/b.jpg');
});

test('bulk CSV validation is dry-run and reports row-level errors without persistence', async () => {
  const result = await validateBulkCsv([
    'contentTopic,facebook,platform,contentType,scheduledLocal,timeZone',
    '供桌整理提醒,先整理供桌,facebook,post,,Asia/Taipei',
    ',缺主題,unknown,reel,,Asia/Taipei',
  ].join('\n'), { clientId: 'client-1' });
  assert.equal(result.dryRun, true);
  assert.equal(result.rowCount, 2);
  assert.equal(result.validRowCount, 1);
  assert.equal(result.invalidRowCount, 1);
  assert.equal(result.valid, false);
  assert.equal(result.rows[0].valid, true);
  assert.ok(result.rows[1].errors.some((error) => error.code === 'ROW_TOPIC_REQUIRED'));
  assert.ok(result.rows[1].errors.some((error) => error.code === 'ROW_PLATFORM_UNSUPPORTED'));

  const videoResult = await validateBulkCsv([
    'contentTopic,facebook,platform,contentType,mediaPaths',
    '短影音批次,短影音文案,instagram,reel,/uploads/demo.mp4',
  ].join('\n'), { clientId: 'client-1' });
  assert.equal(videoResult.valid, true);
  assert.equal(videoResult.rows[0].fields.contentType, 'reel');
  assert.ok(videoResult.rows[0].warnings.some((warning) => warning.code === 'video_metadata_unverified'));
});

test('bulk import preview route returns validation results and never creates posts', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createBulkImportRouter({
    listClients: async () => [{ id: 'client-1', name: 'Brand A' }],
  }));
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/bulk-import/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-1',
        csv: 'contentTopic,facebook,platform\n批次內容,批次文案,facebook',
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.dryRun, true);
    assert.equal(payload.validRowCount, 1);
    assert.equal(payload.rows[0].fields.contentTopic, '批次內容');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('bulk import commit is all-or-nothing and creates unscheduled drafts only after validation', async () => {
  const versionDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-bulk-import-'));
  const originalVersionDirectory = directories.postVersions;
  directories.postVersions = versionDirectory;
  const records = [];
  const repositories = {
    posts: {
      async mutate(mutator) {
        return mutator(records);
      },
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createBulkImportRouter({
    repositories,
    listClients: async () => [{ id: 'client-1', name: 'Brand A' }],
  }));
  const server = app.listen(0);
  try {
    const validResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/bulk-import/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-1',
        csv: 'contentTopic,facebook,platform,contentType,scheduledLocal,timeZone\n批次內容,批次文案,facebook,post,2026-08-20T10:00,Asia/Taipei',
      }),
    });
    assert.equal(validResponse.status, 201);
    const validPayload = await validResponse.json();
    assert.equal(validPayload.createdCount, 1);
    assert.equal(validPayload.drafts[0].status, 'draft');
    assert.equal(validPayload.drafts[0].targets[0].scheduledAt, null);
    assert.equal(validPayload.drafts[0].importedSchedule.requestedAt, '2026-08-20T02:00:00.000Z');
    assert.equal(records.length, 1);

    const invalidResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/bulk-import/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-1',
        csv: 'contentTopic,facebook,platform\n,缺少主題,facebook\n另一列,正常文案,not-a-platform',
      }),
    });
    assert.equal(invalidResponse.status, 400);
    const invalidPayload = await invalidResponse.json();
    assert.equal(invalidPayload.code, 'BULK_IMPORT_VALIDATION_FAILED');
    assert.equal(records.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    directories.postVersions = originalVersionDirectory;
    await fs.rm(versionDirectory, { recursive: true, force: true });
  }
});
