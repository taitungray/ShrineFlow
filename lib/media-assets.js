import crypto from 'node:crypto';
import fs from 'node:fs/promises';

import { getRepositories } from './repositories.js';

export function checksumBufferSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function findReadyAssetByChecksum(assets = [], { clientId = '', checksum = '' } = {}) {
  const digest = String(checksum || '').trim().toLowerCase();
  if (!digest) return null;
  return (Array.isArray(assets) ? assets : [])
    .map(normalizeMediaAsset)
    .find((asset) => (
      asset.status === 'ready'
      && !asset.deletedAt
      && asset.checksumSha256.toLowerCase() === digest
      && (!clientId || asset.clientId === clientId)
    )) || null;
}

export async function findReadyMediaAssetByChecksum({
  clientId = '',
  checksum = '',
} = {}, repositories = getRepositories()) {
  const assets = await listMediaAssets({ clientId }, repositories);
  return findReadyAssetByChecksum(assets, { clientId, checksum });
}

export async function backfillLocalAssetChecksums({
  clientId = '',
  mediaStorage,
  readFile = fs.readFile,
  repositories = getRepositories(),
} = {}) {
  if (!mediaStorage || mediaStorage.backend !== 'local-filesystem') return 0;
  const assets = await listMediaAssets({ clientId }, repositories);
  let updated = 0;
  for (const asset of assets) {
    if (asset.checksumSha256 || asset.status !== 'ready') continue;
    const filePath = mediaStorage.resolveFilePath?.(asset.mediaPath);
    if (!filePath) continue;
    try {
      const digest = checksumBufferSha256(await readFile(filePath));
      await finalizeMediaAsset(asset.id, { checksumSha256: digest, status: 'ready' }, repositories);
      updated += 1;
    } catch {
      // Missing or unreadable files stay without a checksum.
    }
  }
  return updated;
}

export const MEDIA_ASSET_STATUSES = Object.freeze(['pending', 'ready', 'failed', 'deleted']);

function trim(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function nowIso() {
  return new Date().toISOString();
}

export function normalizeMediaAsset(asset = {}) {
  const status = MEDIA_ASSET_STATUSES.includes(String(asset.status || 'pending'))
    ? String(asset.status || 'pending')
    : 'pending';
  return {
    id: trim(asset.id, 160),
    clientId: trim(asset.clientId, 160),
    storageProvider: trim(asset.storageProvider, 40),
    bucket: trim(asset.bucket, 180),
    objectKey: trim(asset.objectKey, 1000),
    mediaPath: trim(asset.mediaPath, 1200),
    originalName: trim(asset.originalName, 240),
    mimeType: trim(asset.mimeType, 120),
    sizeBytes: Math.max(0, Number(asset.sizeBytes) || 0),
    checksumSha256: trim(asset.checksumSha256, 128),
    width: Number(asset.width) || null,
    height: Number(asset.height) || null,
    durationMs: Number(asset.durationMs) || null,
    status,
    createdAt: asset.createdAt || nowIso(),
    updatedAt: asset.updatedAt || nowIso(),
    deletedAt: asset.deletedAt || null,
  };
}

export async function getMediaAsset(mediaId, repositories = getRepositories()) {
  const id = trim(mediaId, 160);
  if (!id) return null;
  const asset = await repositories.mediaAssets.getById(id);
  return asset ? normalizeMediaAsset(asset) : null;
}

export async function listMediaAssets({ clientId = '', includeDeleted = false } = {}, repositories = getRepositories()) {
  const assets = await repositories.mediaAssets.list();
  return (Array.isArray(assets) ? assets : [])
    .map(normalizeMediaAsset)
    .filter((asset) => (!clientId || asset.clientId === clientId) && (includeDeleted || asset.status !== 'deleted'))
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

export async function createPendingMediaAsset(asset, repositories = getRepositories()) {
  const normalized = normalizeMediaAsset({ ...asset, status: 'pending' });
  if (!normalized.id || !normalized.objectKey || !normalized.mediaPath) {
    throw new Error('Media asset id, object key and media path are required.');
  }
  await repositories.mediaAssets.mutate((assets) => {
    const index = assets.findIndex((item) => item.id === normalized.id);
    if (index >= 0) assets[index] = normalized;
    else assets.push(normalized);
    return normalized;
  });
  return normalized;
}

export async function finalizeMediaAsset(mediaId, details = {}, repositories = getRepositories()) {
  const id = trim(mediaId, 160);
  const updated = await repositories.mediaAssets.mutate((assets) => {
    const asset = assets.find((item) => item.id === id);
    if (!asset) return null;
    const deletedAt = details.status === 'deleted'
      ? (details.deletedAt || nowIso())
      : (details.deletedAt || null);
    Object.assign(asset, normalizeMediaAsset({
      ...asset,
      ...details,
      id,
      status: details.status || 'ready',
      updatedAt: nowIso(),
      deletedAt,
    }));
    return asset;
  });
  return updated ? normalizeMediaAsset(updated) : null;
}

export async function markMediaAssetDeleted(mediaId, repositories = getRepositories()) {
  return finalizeMediaAsset(mediaId, { status: 'deleted', deletedAt: nowIso() }, repositories);
}
