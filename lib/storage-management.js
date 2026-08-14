import fs from 'node:fs/promises';
import path from 'node:path';

import { directories, jsonFiles, makeId, readJson, writeJson } from './store.js';

const BACKUP_SCHEMA_VERSION = 1;

export const BACKUP_RETENTION_POLICY = Object.freeze({
  maxCount: 30,
  maxAgeDays: 180,
});

function backupJsonFiles() {
  return Object.entries(jsonFiles);
}

function backupError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertBackupId(backupId) {
  const value = String(backupId || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw backupError('備份識別碼格式不正確。');
  return value;
}

async function copyDirectory(source, destination) {
  try {
    await fs.access(source);
  } catch {
    return false;
  }
  await fs.cp(source, destination, { recursive: true, force: true });
  return true;
}

function newBackupId() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${makeId()}`;
}

async function readManifest(backupId) {
  const safeId = assertBackupId(backupId);
  const backupPath = path.join(directories.backups, safeId);
  const manifestPath = path.join(backupPath, 'manifest.json');
  const manifest = await readJson(manifestPath, null);
  if (!manifest || manifest.id !== safeId || manifest.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw backupError('備份不存在或格式不受支援。', 404);
  }
  return { safeId, backupPath, manifest };
}

async function pruneBackups({ preserveIds = [] } = {}) {
  const backups = await listBackups();
  const preserved = new Set(preserveIds);
  const cutoff = Date.now() - (BACKUP_RETENTION_POLICY.maxAgeDays * 24 * 60 * 60 * 1000);
  const deleted = [];

  for (const [index, backup] of backups.entries()) {
    if (preserved.has(backup.id)) continue;
    const exceedsCount = index >= BACKUP_RETENTION_POLICY.maxCount;
    const exceedsAge = Number.isFinite(Date.parse(backup.createdAt))
      && Date.parse(backup.createdAt) < cutoff;
    if (!exceedsCount && !exceedsAge) continue;

    const backupPath = path.resolve(directories.backups, backup.id);
    if (path.dirname(backupPath) !== path.resolve(directories.backups)) continue;
    await fs.rm(backupPath, { recursive: true, force: true });
    deleted.push(backup.id);
  }
  return deleted;
}

export async function createBackup({ includeMedia = false, preserveIds = [] } = {}) {
  const id = newBackupId();
  const backupPath = path.join(directories.backups, id);
  const dataPath = path.join(backupPath, 'data');
  await fs.mkdir(dataPath, { recursive: true });

  const files = [];
  for (const [name, source] of backupJsonFiles()) {
    try {
      await fs.copyFile(source, path.join(dataPath, name + '.json'));
      files.push(name + '.json');
    } catch {
      // A missing optional file is omitted from the manifest.
    }
  }
  for (const directoryName of ['insights', 'publishAttempts']) {
    const copied = await copyDirectory(
      directories[directoryName],
      path.join(dataPath, directoryName),
    );
    if (copied) files.push(`data/${directoryName}/`);
  }

  let mediaFileCount = 0;
  if (includeMedia) {
    const copied = await copyDirectory(directories.uploads, path.join(backupPath, 'uploads'));
    if (copied) {
      mediaFileCount = (await uploadFiles()).length;
      files.push('uploads/');
    }
  }

  const manifest = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    id,
    createdAt: new Date().toISOString(),
    includesSecrets: false,
    includesMedia: Boolean(includeMedia),
    mediaFileCount,
    retention: BACKUP_RETENTION_POLICY,
    files,
  };
  await writeJson(path.join(backupPath, 'manifest.json'), manifest);
  await pruneBackups({ preserveIds: [...preserveIds, id] });
  return manifest;
}

export async function listBackups() {
  const names = await fs.readdir(directories.backups, { withFileTypes: true }).catch(() => []);
  const manifests = [];
  for (const entry of names) {
    if (!entry.isDirectory()) continue;
    const manifest = await readJson(path.join(directories.backups, entry.name, 'manifest.json'), null);
    if (manifest?.id === entry.name) manifests.push(manifest);
  }
  return manifests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function restoreBackup(backupId, { includeMedia = false } = {}) {
  const { safeId, backupPath, manifest } = await readManifest(backupId);
  const safetyBackup = await createBackup({ includeMedia, preserveIds: [safeId] });
  const dataPath = path.join(backupPath, 'data');

  for (const [name, destination] of backupJsonFiles()) {
    const source = path.join(dataPath, name + '.json');
    try {
      const content = await fs.readFile(source, 'utf8');
      await writeJson(destination, JSON.parse(content));
    } catch {
      // Missing optional files keep their current value.
    }
  }
  for (const directoryName of ['insights', 'publishAttempts']) {
    const source = path.join(dataPath, directoryName);
    try {
      await fs.access(source);
      await fs.rm(directories[directoryName], { recursive: true, force: true });
      await fs.mkdir(directories[directoryName], { recursive: true });
      await copyDirectory(source, directories[directoryName]);
    } catch {
      // The backup predates this directory or has no records for it.
    }
  }
  if (includeMedia && manifest.includesMedia) {
    const source = path.join(backupPath, 'uploads');
    await fs.rm(directories.uploads, { recursive: true, force: true });
    await fs.mkdir(directories.uploads, { recursive: true });
    await copyDirectory(source, directories.uploads);
  }

  return { restored: manifest, safetyBackup };
}

async function uploadFiles() {
  const entries = await fs.readdir(directories.uploads, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === '.gitkeep') continue;
    const filePath = path.join(directories.uploads, entry.name);
    const stats = await fs.stat(filePath);
    files.push({ name: entry.name, size: stats.size, modifiedAt: stats.mtime.toISOString() });
  }
  return files;
}

export async function scanStorageHealth() {
  const posts = await readJson(jsonFiles.posts, []);
  const referenced = new Set();
  for (const post of posts) {
    const mediaPaths = Array.isArray(post.mediaPaths) ? post.mediaPaths : [];
    if (post.imagePath) mediaPaths.push(post.imagePath);
    for (const mediaPath of mediaPaths) {
      if (String(mediaPath).startsWith('/uploads/')) referenced.add(path.basename(String(mediaPath)));
    }
    for (const target of post.targets || []) {
      for (const mediaPath of target.mediaPaths || []) {
        if (String(mediaPath).startsWith('/uploads/')) referenced.add(path.basename(String(mediaPath)));
      }
    }
  }
  const files = await uploadFiles();
  const orphanFiles = files.filter((file) => !referenced.has(file.name));
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const orphanBytes = orphanFiles.reduce((sum, file) => sum + file.size, 0);
  return {
    generatedAt: new Date().toISOString(),
    uploads: {
      fileCount: files.length,
      totalBytes,
      referencedFileCount: files.length - orphanFiles.length,
      orphanFileCount: orphanFiles.length,
      orphanBytes,
      orphanFiles,
    },
    backups: await listBackups(),
    policy: {
      secretsIncluded: false,
      orphanDeletionRequiresExplicitConfirmation: true,
      restoreCreatesSafetyBackup: true,
      backupRetention: BACKUP_RETENTION_POLICY,
      historicalEventArchivesRetained: true,
    },
  };
}

export async function cleanupOrphanUploads({ confirm = false } = {}) {
  const health = await scanStorageHealth();
  if (!confirm) return { dryRun: true, deleted: [], health };
  const deleted = [];
  for (const file of health.uploads.orphanFiles) {
    const filePath = path.join(directories.uploads, file.name);
    if (path.dirname(filePath) !== path.resolve(directories.uploads)) continue;
    await fs.unlink(filePath);
    deleted.push(file.name);
  }
  return { dryRun: false, deleted, health: await scanStorageHealth() };
}
