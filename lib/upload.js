import path from 'node:path';
import fs from 'node:fs/promises';
import multer from 'multer';
import { directories } from './store.js';
import {
  getUploadQuotaStatus,
  UPLOAD_RETENTION_POLICY,
} from './storage-management.js';
import { getMediaStorage } from './media-storage.js';
import {
  backfillLocalAssetChecksums,
  checksumBufferSha256,
  createPendingMediaAsset,
  finalizeMediaAsset,
  findReadyMediaAssetByChecksum,
} from './media-assets.js';
import { getRepositories } from './repositories.js';

const localStorage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, directories.uploads),
  filename: (_request, file, callback) => {
    const safeName = path.basename(file.originalname).replace(/[^\w.\-\u00C0-\uFFFF]+/g, '_');
    callback(null, Date.now() + '-' + (safeName || 'image'));
  },
});

const storage = ['r2', 'cloudflare-r2'].includes(String(process.env.SHRINEFLOW_MEDIA_BACKEND || '').trim().toLowerCase())
  ? multer.memoryStorage()
  : localStorage;

export const upload = multer({
  storage,
  limits: {
    fileSize: UPLOAD_RETENTION_POLICY.maxFileSizeBytes,
    files: UPLOAD_RETENTION_POLICY.maxFilesPerRequest,
  },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      callback(null, true);
    } else {
      callback(new Error('目前只接受圖片或影片檔案。'));
    }
  },
});

function uploadQuotaError(quota) {
  const error = new Error('uploads 儲存空間已達上限，請先清理未使用素材後再上傳。');
  error.status = 413;
  error.quota = quota;
  return error;
}

export async function enforceUploadQuota(request, response, next) {
  try {
    const contentLength = Number(request.get('content-length') || 0);
    const quota = await getUploadQuotaStatus({
      incomingBytes: Number.isFinite(contentLength) ? contentLength : 0,
      incomingFiles: UPLOAD_RETENTION_POLICY.maxFilesPerRequest,
    });
    if (!quota.allowed) {
      const error = uploadQuotaError(quota);
      return response.status(error.status).json({ error: error.message, quota });
    }
    next();
  } catch (error) {
    next(error);
  }
}

export async function enforceUploadedFileQuota(request, response, next) {
  try {
    const quota = await getUploadQuotaStatus();
    if (quota.allowed) return next();
    for (const file of request.files || []) {
      if (file.path) await fs.unlink(file.path).catch(() => {});
    }
    const error = uploadQuotaError(quota);
    return response.status(error.status).json({ error: error.message, quota });
  } catch (error) {
    next(error);
  }
}

export function resolvePostMediaPaths(post) {
  const mediaPaths = Array.isArray(post.mediaPaths) && post.mediaPaths.length
    ? post.mediaPaths
    : (post.imagePath ? [post.imagePath] : []);
  return mediaPaths
    .filter((mediaPath) => String(mediaPath).startsWith('/uploads/'))
    .map((mediaPath) => path.join(directories.uploads, path.basename(String(mediaPath))));
}

async function readUploadBuffer(file) {
  if (file?.buffer) return file.buffer;
  if (file?.path) return fs.readFile(file.path);
  throw new Error('Upload file has no readable content.');
}

function reusedUpload(file, asset, checksum) {
  return {
    ...file,
    mediaId: asset.id,
    filename: String(asset.mediaPath || '').split('/').pop() || file.filename,
    path: asset.mediaPath,
    mediaPath: asset.mediaPath,
    objectKey: asset.objectKey,
    reused: true,
    checksumSha256: checksum,
  };
}

export async function persistUploadedFiles(files = [], {
  clientId = 'default',
  repositories = getRepositories(),
  mediaStorage = getMediaStorage(),
} = {}) {
  const persisted = [];
  await backfillLocalAssetChecksums({ clientId, mediaStorage, repositories });
  for (const file of files) {
    const buffer = await readUploadBuffer(file);
    const checksum = checksumBufferSha256(buffer);
    const existing = await findReadyMediaAssetByChecksum({ clientId, checksum }, repositories);
    if (existing) {
      if (file.path) await fs.unlink(file.path).catch(() => {});
      persisted.push(reusedUpload(file, existing, checksum));
      continue;
    }

    if (mediaStorage.backend === 'r2') {
      const session = mediaStorage.createUploadSession({
        clientId,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      });
      await createPendingMediaAsset({
        id: session.mediaId,
        clientId,
        storageProvider: 'r2',
        bucket: mediaStorage.bucket,
        objectKey: session.objectKey,
        mediaPath: session.mediaPath,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        checksumSha256: checksum,
      }, repositories);
      await mediaStorage.putBuffer(session.objectKey, file.buffer || buffer, { contentType: file.mimetype });
      const head = await mediaStorage.headObject(session.objectKey);
      const asset = await finalizeMediaAsset(session.mediaId, {
        sizeBytes: head.sizeBytes || file.size,
        mimeType: head.contentType || file.mimetype,
        checksumSha256: checksum,
        status: 'ready',
      }, repositories);
      persisted.push({
        ...file,
        mediaId: asset?.id || session.mediaId,
        filename: session.objectKey.split('/').pop(),
        path: session.mediaPath,
        mediaPath: session.mediaPath,
        objectKey: session.objectKey,
        checksumSha256: checksum,
      });
      continue;
    }

    const mediaPath = '/uploads/' + file.filename;
    const mediaId = String(file.filename || '').replace(/[^\w-]/g, '-');
    await createPendingMediaAsset({
      id: mediaId,
      clientId,
      storageProvider: 'local-filesystem',
      objectKey: file.filename,
      mediaPath,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      checksumSha256: checksum,
    }, repositories);
    await finalizeMediaAsset(mediaId, {
      checksumSha256: checksum,
      status: 'ready',
    }, repositories);
    persisted.push({ ...file, mediaId, mediaPath, checksumSha256: checksum });
  }
  return persisted;
}
