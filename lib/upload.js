import path from 'node:path';
import fs from 'node:fs/promises';
import multer from 'multer';
import { directories } from './store.js';
import {
  getUploadQuotaStatus,
  UPLOAD_RETENTION_POLICY,
} from './storage-management.js';

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, directories.uploads),
  filename: (_request, file, callback) => {
    const safeName = path.basename(file.originalname).replace(/[^\w.\-\u00C0-\uFFFF]+/g, '_');
    callback(null, Date.now() + '-' + (safeName || 'image'));
  },
});

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
      await fs.unlink(file.path).catch(() => {});
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
