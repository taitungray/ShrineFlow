import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectSystemHealth } from '../lib/system-health.js';
import { directories, jsonFiles, writeJson } from '../lib/store.js';

test('system health reports degraded JSON state without exposing storage paths', async () => {
  const originalJsonFiles = { ...jsonFiles };
  const originalDirectories = { ...directories };
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-health-'));
  const backupDirectory = path.join(temporaryDirectory, 'backups');
  const uploadsDirectory = path.join(temporaryDirectory, 'uploads');
  await fs.mkdir(backupDirectory, { recursive: true });
  await fs.mkdir(uploadsDirectory, { recursive: true });
  for (const key of Object.keys(jsonFiles)) jsonFiles[key] = path.join(temporaryDirectory, `${key}.json`);
  directories.backups = backupDirectory;
  directories.uploads = uploadsDirectory;
  try {
    await Promise.all(Object.values(jsonFiles).map((filePath) => writeJson(filePath, [])));
    await fs.writeFile(jsonFiles.posts, '{ invalid', 'utf8');
    await writeJson(`${jsonFiles.posts}.bak`, [{ id: 'recovery' }]);
    await writeJson(path.join(backupDirectory, 'valid', 'manifest.json'), { id: 'valid' });
    const health = await inspectSystemHealth({ schedulerIntervalMs: 30_000, schedulerRunning: true });
    assert.equal(health.status, 'degraded');
    assert.equal(health.scheduler.intervalSeconds, 30);
    assert.equal(health.scheduler.running, true);
    assert.equal(health.storage.jsonFiles.recovered, 1);
    assert.equal(health.storage.backups.count, 1);
    assert.equal(JSON.stringify(health).includes(temporaryDirectory), false);
  } finally {
    Object.assign(jsonFiles, originalJsonFiles);
    Object.assign(directories, originalDirectories);
  }
});
test('system health warns when JSON or upload usage reaches 80 percent', async () => {
  const originalJsonFiles = { ...jsonFiles };
  const originalDirectories = { ...directories };
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-health-usage-'));
  await fs.mkdir(path.join(temporaryDirectory, 'backups'), { recursive: true });
  for (const key of Object.keys(jsonFiles)) jsonFiles[key] = path.join(temporaryDirectory, `${key}.json`);
  directories.backups = path.join(temporaryDirectory, 'backups');
  try {
    await Promise.all(Object.values(jsonFiles).map((filePath) => writeJson(filePath, [])));
    await writeJson(jsonFiles.posts, Array.from({ length: 4000 }, (_item, index) => ({ id: `post-${index}` })));
    const health = await inspectSystemHealth({
      uploadQuotaImpl: async () => ({
        fileCount: 800,
        totalBytes: 800,
        allowed: true,
        policy: { maxFileCount: 1000, maxTotalBytes: 1000 },
      }),
      listBackupsImpl: async () => [],
      errorLogStatsImpl: async () => ({ count: 0 }),
    });
    assert.equal(health.storage.jsonFiles.details.posts.usage.status, 'warning');
    assert.ok(health.storage.jsonFiles.details.posts.usage.warningReasons.includes('items'));
    assert.equal(health.storage.uploads.usage.status, 'warning');
    assert.deepEqual(health.storage.uploads.usage.warningReasons, ['files', 'bytes']);
  } finally {
    Object.assign(jsonFiles, originalJsonFiles);
    Object.assign(directories, originalDirectories);
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});