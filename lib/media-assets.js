import { getRepositories } from './repositories.js';

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
    Object.assign(asset, normalizeMediaAsset({
      ...asset,
      ...details,
      id,
      status: details.status || 'ready',
      updatedAt: nowIso(),
      deletedAt: null,
    }));
    return asset;
  });
  return updated ? normalizeMediaAsset(updated) : null;
}

export async function markMediaAssetDeleted(mediaId, repositories = getRepositories()) {
  return finalizeMediaAsset(mediaId, { status: 'deleted', deletedAt: nowIso() }, repositories);
}
