import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { directories } from './store.js';
import { rewriteMediaPathsInRecord } from './firestore-migration.js';

const MIME_TYPES = Object.freeze({
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
});

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(filePath));
    else if (entry.isFile() && entry.name !== '.gitkeep') files.push(filePath);
  }
  return files;
}

function safeName(value) {
  return String(value || 'upload').replace(/[^\w.\-\u00C0-\uFFFF]+/g, '_').slice(0, 180) || 'upload';
}

function contentType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function mediaIdFor(relativeName, buffer) {
  return 'legacy-' + crypto.createHash('sha256').update(relativeName).update(buffer).digest('hex').slice(0, 32);
}

function checksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeEtag(value) {
  return String(value || '').replace(/"/g, '').trim().toLowerCase();
}

export async function buildMediaMigrationPlan({
  uploadsDirectory = directories.uploads,
  mediaStorage,
  referencedPaths = [],
} = {}) {
  if (!mediaStorage) throw new Error('mediaStorage is required.');
  const files = await listFiles(uploadsDirectory);
  const mapping = {};
  const plannedFiles = [];

  for (const filePath of files) {
    const relativeName = path.relative(uploadsDirectory, filePath).split(path.sep).join('/');
    const buffer = await fs.readFile(filePath);
    const mediaId = mediaIdFor(relativeName, buffer);
    const objectKey = 'legacy/' + mediaId + '/' + safeName(path.basename(relativeName));
    const mediaPath = mediaStorage.getMediaPath(objectKey);
    const oldPath = '/uploads/' + relativeName;
    const digest = checksum(buffer);
    mapping[oldPath] = mediaPath;
    if (relativeName === path.basename(relativeName)) {
      mapping['/uploads/' + path.basename(relativeName)] = mediaPath;
    }
    plannedFiles.push({
      oldPath,
      relativeName,
      filePath,
      mediaId,
      objectKey,
      mediaPath,
      mimeType: contentType(filePath),
      sizeBytes: buffer.byteLength,
      checksumSha256: digest,
    });
  }

  const conflicts = [];
  for (const referenced of referencedPaths) {
    const current = String(referenced || '');
    if (!current.startsWith('/uploads/')) continue;
    if (!mapping[current]) {
      conflicts.push({
        action: 'conflict',
        path: current,
        reason: 'missing_upload_file',
      });
    }
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    bucket: mediaStorage.bucket || '',
    files: plannedFiles,
    mapping,
    conflicts,
  };
}

export async function applyMediaMigrationPlan({
  plan,
  mediaStorage,
  upsertAsset,
  readFile = fs.readFile,
} = {}) {
  if (!plan) throw new Error('Media migration plan is required.');
  if ((plan.conflicts || []).length) {
    const error = new Error(`Media plan still has ${plan.conflicts.length} blocking conflict(s).`);
    error.code = 'MEDIA_CONFLICTS_REMAIN';
    throw error;
  }

  const uploaded = [];
  for (const file of plan.files || []) {
    const buffer = await readFile(file.filePath);
    const digest = checksum(buffer);
    if (digest !== file.checksumSha256) {
      const error = new Error(`Upload file changed since plan was created: ${file.oldPath}`);
      error.code = 'MEDIA_SOURCE_CHANGED';
      throw error;
    }

    let existing = null;
    try {
      existing = await mediaStorage.headObject(file.objectKey);
    } catch {
      existing = null;
    }

    const reuse = Boolean(existing) && (
      normalizeEtag(existing.checksumSha256) === digest
      || normalizeEtag(existing.etag) === digest
      || Boolean(existing)
    );

    if (!reuse) {
      await mediaStorage.putBuffer(file.objectKey, buffer, { contentType: file.mimeType });
    }

    const asset = await upsertAsset({
      id: file.mediaId,
      storageProvider: 'r2',
      bucket: mediaStorage.bucket,
      objectKey: file.objectKey,
      mediaPath: file.mediaPath,
      originalName: path.basename(file.relativeName),
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      checksumSha256: digest,
      status: 'ready',
    });
    uploaded.push({
      ...file,
      reused: Boolean(existing),
      assetId: asset?.id || file.mediaId,
    });
  }

  return { uploaded, mapping: plan.mapping };
}

export function applyMediaMappingToRecords(records = [], mappingObject = {}) {
  const mapping = mappingObject instanceof Map
    ? mappingObject
    : new Map(Object.entries(mappingObject || {}));
  const missing = [];
  const next = [];
  let changed = 0;
  for (const record of records) {
    const rewritten = rewriteMediaPathsInRecord(record, mapping);
    if (rewritten.changed) changed += 1;
    missing.push(...rewritten.missing);
    next.push(rewritten.record);
  }
  return {
    records: next,
    changed,
    missing: [...new Set(missing)],
  };
}
