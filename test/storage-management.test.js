import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  BACKUP_RETENTION_POLICY,
  UPLOAD_RETENTION_POLICY,
  cleanupOrphanUploads,
  createBackup,
  getUploadQuotaStatus,
  listBackups,
  restoreBackup,
  scanStorageHealth,
} from '../lib/storage-management.js';
import { directories, jsonFiles, writeJson } from '../lib/store.js';

test('backup, restore and orphan media cleanup preserve data without secrets', async () => {
  const originalDirectories = { ...directories };
  const originalJsonFiles = { ...jsonFiles };
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-storage-'));
  const temporaryData = path.join(temporaryDirectory, 'data');
  await fs.mkdir(path.join(temporaryData, 'backups'), { recursive: true });
  await fs.mkdir(path.join(temporaryData, 'uploads'), { recursive: true });
  for (const key of Object.keys(jsonFiles)) jsonFiles[key] = path.join(temporaryData, `${key}.json`);
  directories.backups = path.join(temporaryData, 'backups');
  directories.uploads = path.join(temporaryData, 'uploads');
  directories.insights = path.join(temporaryData, 'insights');
  directories.publishAttempts = path.join(temporaryData, 'publish-attempts');

  try {
    await Promise.all(Object.values(jsonFiles).map((filePath) => writeJson(filePath, [])));
    await writeJson(jsonFiles.posts, [{
      id: 'post-1',
      mediaPaths: ['/uploads/used.jpg'],
      targets: [],
    }]);
    await fs.writeFile(path.join(directories.uploads, 'used.jpg'), 'used');
    await fs.writeFile(path.join(directories.uploads, 'orphan.jpg'), 'orphan');

    const health = await scanStorageHealth();
    assert.equal(health.uploads.fileCount, 2);
    assert.equal(health.uploads.orphanFileCount, 1);

    const manifest = await createBackup({ includeMedia: true });
    assert.equal(manifest.includesSecrets, false);
    assert.equal(manifest.includesMedia, true);
    assert.equal((await listBackups()).length, 1);

    await writeJson(jsonFiles.posts, []);
    await fs.rm(directories.uploads, { recursive: true, force: true });
    await fs.mkdir(directories.uploads, { recursive: true });
    const restored = await restoreBackup(manifest.id, { includeMedia: true });
    assert.equal(restored.restored.id, manifest.id);
    assert.equal(restored.safetyBackup.includesSecrets, false);
    assert.equal((await fs.readFile(jsonFiles.posts, 'utf8')).includes('post-1'), true);
    assert.equal((await fs.readdir(directories.uploads)).includes('used.jpg'), true);
    assert.equal((await listBackups()).length, 2);

    const preview = await cleanupOrphanUploads({ confirm: false });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.deleted.length, 0);
    const cleaned = await cleanupOrphanUploads({ confirm: true });
    assert.deepEqual(cleaned.deleted, ['orphan.jpg']);
    assert.equal((await fs.readdir(directories.uploads)).includes('orphan.jpg'), false);

    await fs.writeFile(path.join(directories.uploads, 'old-orphan.jpg'), 'old');
    await fs.writeFile(path.join(directories.uploads, 'fresh-orphan.jpg'), 'fresh');
    const oldTime = new Date(Date.now() - (UPLOAD_RETENTION_POLICY.orphanMaxAgeDays + 1) * 24 * 60 * 60 * 1000);
    await fs.utimes(path.join(directories.uploads, 'old-orphan.jpg'), oldTime, oldTime);
    const autoHealth = await scanStorageHealth();
    assert.equal(autoHealth.uploads.eligibleOrphanFileCount, 1);
    const autoCleaned = await cleanupOrphanUploads({ mode: 'automatic' });
    assert.deepEqual(autoCleaned.deleted, ['old-orphan.jpg']);
    assert.equal((await fs.readdir(directories.uploads)).includes('fresh-orphan.jpg'), true);

    const quota = await getUploadQuotaStatus({ incomingBytes: 1, incomingFiles: 1 });
    assert.equal(quota.allowed, true);
    assert.equal(quota.policy.maxFileCount, 1000);

    for (let index = 0; index < BACKUP_RETENTION_POLICY.maxCount + 3; index += 1) {
      await createBackup();
    }
    assert.equal((await listBackups()).length, BACKUP_RETENTION_POLICY.maxCount);
  } finally {
    Object.assign(directories, originalDirectories);
    Object.assign(jsonFiles, originalJsonFiles);
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
