import crypto from 'node:crypto';

import { getMediaStorage } from './media-storage.js';
import { getRepositories } from './repositories.js';
import { finalizeMediaAsset, listMediaAssets } from './media-assets.js';

const BACKUP_COLLECTIONS = [
  'clients',
  'posts',
  'schedule',
  'templates',
  'campaigns',
  'savedReplies',
  'gods',
  'mediaAssets',
  'postVersions',
  'publishAttempts',
  'insightsSnapshots',
  'notifications',
  'inboxMetadata',
  'errorLog',
  'auditEvents',
  'users',
  'memberships',
  'invitations',
  'appSettings',
];

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function checksum(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function exportFirestoreBackup({
  repositories = getRepositories(),
  mediaStorage = getMediaStorage(),
  now = () => Date.now(),
} = {}) {
  if (repositories.backend !== 'firestore') {
    const error = new Error('Firestore backup requires the firestore repository backend.');
    error.status = 409;
    error.code = 'FIRESTORE_BACKUP_BACKEND_REQUIRED';
    throw error;
  }
  if (mediaStorage.backend !== 'r2') {
    const error = new Error('Cloud backup requires the R2 media backend.');
    error.status = 409;
    error.code = 'R2_BACKUP_BACKEND_REQUIRED';
    throw error;
  }

  const createdAt = isoDate(now());
  const prefix = 'backups/firestore/' + createdAt.toISOString().slice(0, 10).replace(/-/g, '/') + '/' + createdAt.toISOString().replace(/[:.]/g, '-') + '/';
  const files = [];
  for (const collection of BACKUP_COLLECTIONS) {
    const value = await repositories[collection]?.list();
    if (value === undefined) continue;
    const content = Buffer.from(JSON.stringify({ schemaVersion: repositories.schemaVersion || 1, collection, value }));
    const objectKey = prefix + collection + '.json';
    await mediaStorage.putBuffer(objectKey, content, { contentType: 'application/json' });
    files.push({
      collection,
      objectKey,
      itemCount: Array.isArray(value) ? value.length : Object.keys(value || {}).length,
      sizeBytes: content.byteLength,
      checksumSha256: checksum(content),
    });
  }

  const manifest = {
    schemaVersion: 1,
    createdAt: createdAt.toISOString(),
    storageProvider: 'r2',
    bucket: mediaStorage.bucket,
    files,
  };
  const manifestContent = Buffer.from(JSON.stringify(manifest, null, 2));
  await mediaStorage.putBuffer(prefix + 'manifest.json', manifestContent, { contentType: 'application/json' });
  return { ...manifest, manifestObjectKey: prefix + 'manifest.json' };
}

export async function cleanupOrphanMedia({
  repositories = getRepositories(),
  mediaStorage = getMediaStorage(),
  now = () => Date.now(),
  orphanAgeDays = 30,
} = {}) {
  if (mediaStorage.backend !== 'r2') return { deleted: [], skipped: 'media_backend_not_r2' };
  const posts = await repositories.posts.list();
  const referenced = new Set();
  for (const post of posts) {
    const paths = [
      ...(Array.isArray(post.mediaPaths) ? post.mediaPaths : []),
      ...(post.imagePath ? [post.imagePath] : []),
      ...(Array.isArray(post.targets) ? post.targets.flatMap((target) => target.mediaPaths || []) : []),
    ];
    paths.forEach((mediaPath) => referenced.add(String(mediaPath)));
  }
  const cutoff = now() - orphanAgeDays * 24 * 60 * 60 * 1000;
  const assets = await listMediaAssets({ includeDeleted: false }, repositories);
  const deleted = [];
  for (const asset of assets) {
    const createdAt = Date.parse(asset.createdAt || asset.updatedAt || '');
    if (!Number.isFinite(createdAt) || createdAt > cutoff || referenced.has(asset.mediaPath)) continue;
    await mediaStorage.delete(asset.mediaPath);
    await finalizeMediaAsset(asset.id, { status: 'deleted', deletedAt: new Date().toISOString() }, repositories);
    deleted.push(asset.id);
  }
  return { deleted, cutoff: new Date(cutoff).toISOString() };
}
