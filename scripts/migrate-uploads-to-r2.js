import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { directories } from '../lib/store.js';
import { createFirestoreRepositories } from '../lib/repositories.js';
import { createR2MediaStorage } from '../lib/r2-storage.js';
import { createPendingMediaAsset, finalizeMediaAsset } from '../lib/media-assets.js';

const dryRun = process.argv.includes('--dry-run');

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

function rewriteRecord(record, mapping) {
  let changed = false;
  const rewrite = (value) => {
    const next = mapping.get(String(value || '')) || value;
    if (next !== value) changed = true;
    return next;
  };
  if (record.imagePath) record.imagePath = rewrite(record.imagePath);
  if (Array.isArray(record.mediaPaths)) record.mediaPaths = record.mediaPaths.map(rewrite);
  if (Array.isArray(record.targets)) {
    record.targets = record.targets.map((target) => ({
      ...target,
      mediaPaths: Array.isArray(target.mediaPaths) ? target.mediaPaths.map(rewrite) : target.mediaPaths,
    }));
  }
  return changed;
}

async function rewriteCollection(repositories, name, mapping) {
  const repository = repositories[name];
  if (!repository) return 0;
  const records = await repository.list();
  if (!Array.isArray(records)) return 0;
  let changed = 0;
  for (const record of records) if (rewriteRecord(record, mapping)) changed += 1;
  if (changed && !dryRun) await repository.replace(records);
  return changed;
}

const repositories = createFirestoreRepositories();
const mediaStorage = createR2MediaStorage();
const mapping = new Map();
const files = await listFiles(directories.uploads);

for (const filePath of files) {
  const relativeName = path.relative(directories.uploads, filePath).split(path.sep).join('/');
  const buffer = await fs.readFile(filePath);
  const mediaId = mediaIdFor(relativeName, buffer);
  const objectKey = 'legacy/' + mediaId + '/' + safeName(path.basename(relativeName));
  const mediaPath = mediaStorage.getMediaPath(objectKey);
  const oldPath = '/uploads/' + relativeName;
  mapping.set(oldPath, mediaPath);
  if (relativeName === path.basename(relativeName)) mapping.set('/uploads/' + path.basename(relativeName), mediaPath);
  if (dryRun) {
    console.log('Would migrate ' + oldPath + ' -> ' + mediaPath);
    continue;
  }
  const type = contentType(filePath);
  await mediaStorage.putBuffer(objectKey, buffer, { contentType: type });
  await createPendingMediaAsset({
    id: mediaId,
    storageProvider: 'r2',
    bucket: mediaStorage.bucket,
    objectKey,
    mediaPath,
    originalName: path.basename(relativeName),
    mimeType: type,
    sizeBytes: buffer.byteLength,
  }, repositories);
  await finalizeMediaAsset(mediaId, { status: 'ready' }, repositories);
  console.log('Migrated ' + oldPath + ' -> ' + mediaPath);
}

if (!dryRun) {
  const postChanges = await rewriteCollection(repositories, 'posts', mapping);
  const scheduleChanges = await rewriteCollection(repositories, 'schedule', mapping);
  console.log('Rewrote media references: posts=' + postChanges + ', schedule=' + scheduleChanges);
} else {
  console.log('Dry run: no R2 objects or Firestore records were changed.');
}
