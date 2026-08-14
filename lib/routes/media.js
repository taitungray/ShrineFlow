import { Router } from 'express';

import {
  createPendingMediaAsset,
  finalizeMediaAsset,
  getMediaAsset,
  listMediaAssets,
  markMediaAssetDeleted,
} from '../media-assets.js';
import { getMediaStorage } from '../media-storage.js';
import { getRepositories } from '../repositories.js';
import { filterAccessibleClients, requestedOrAccessibleClientId } from '../request-scope.js';

const MAX_MEDIA_SIZE_BYTES = 20 * 1024 * 1024;

function mediaError(message, status = 400, code = 'MEDIA_REQUEST_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function safeMimeType(value) {
  const mimeType = String(value || '').trim().toLowerCase();
  if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
    throw mediaError('Only image and video uploads are supported.');
  }
  return mimeType;
}

export function createMediaRouter({ repositories = getRepositories() } = {}) {
  const router = Router();

  router.get('/media', async (request, response) => {
    const assets = await listMediaAssets({
      clientId: String(request.query.clientId || '').trim(),
      includeDeleted: request.query.includeDeleted === 'true',
    }, repositories);
    response.json({ assets: filterAccessibleClients(assets, request, request.query.clientId) });
  });

  router.post('/media/upload-session', async (request, response) => {
    try {
      const storage = getMediaStorage();
      if (storage.backend !== 'r2') throw mediaError('R2 media storage is not enabled.', 409, 'MEDIA_BACKEND_NOT_R2');
      const body = request.body || {};
      const clientId = requestedOrAccessibleClientId(request, body.clientId, 'default');
      if (!clientId) throw mediaError('Client is required.', 400, 'CLIENT_REQUIRED');
      const mimeType = safeMimeType(body.mimeType);
      const sizeBytes = Number(body.sizeBytes) || 0;
      if (sizeBytes <= 0 || sizeBytes > MAX_MEDIA_SIZE_BYTES) {
        throw mediaError('Media size must be between 1 byte and 20 MB.');
      }
      const session = storage.createUploadSession({
        clientId,
        originalName: body.originalName,
        mimeType,
        sizeBytes,
      });
      const asset = await createPendingMediaAsset({
        id: session.mediaId,
        clientId,
        storageProvider: 'r2',
        bucket: storage.bucket,
        objectKey: session.objectKey,
        mediaPath: session.mediaPath,
        originalName: body.originalName,
        mimeType,
        sizeBytes,
      }, repositories);
      response.status(201).json({ session, asset });
    } catch (error) {
      response.status(error.status || 500).json({ error: error.message, code: error.code || 'MEDIA_UPLOAD_SESSION_FAILED' });
    }
  });

  router.post('/media/finalize', async (request, response) => {
    try {
      const mediaId = String(request.body?.mediaId || '').trim();
      const asset = await getMediaAsset(mediaId, repositories);
      if (!asset) throw mediaError('Media asset not found.', 404, 'MEDIA_NOT_FOUND');
      const storage = getMediaStorage();
      if (storage.backend === 'r2') {
        const head = await storage.headObject(asset.objectKey);
        if (!head.sizeBytes || head.sizeBytes > MAX_MEDIA_SIZE_BYTES) {
          throw mediaError('Uploaded media is missing or exceeds the size limit.', 400, 'MEDIA_SIZE_INVALID');
        }
        if (head.contentType && !head.contentType.startsWith('image/') && !head.contentType.startsWith('video/')) {
          throw mediaError('Uploaded object type is not supported.', 400, 'MEDIA_TYPE_INVALID');
        }
        const finalized = await finalizeMediaAsset(mediaId, {
          status: 'ready',
          sizeBytes: head.sizeBytes,
          mimeType: head.contentType || asset.mimeType,
        }, repositories);
        return response.json({ asset: finalized });
      }
      response.json({ asset: await finalizeMediaAsset(mediaId, { status: 'ready' }, repositories) });
    } catch (error) {
      response.status(error.status || 500).json({ error: error.message, code: error.code || 'MEDIA_FINALIZE_FAILED' });
    }
  });

  router.get('/media/:mediaId/view-url', async (request, response) => {
    try {
      const asset = await getMediaAsset(request.params.mediaId, repositories);
      if (!asset || asset.status !== 'ready') throw mediaError('Media asset is not ready.', 404, 'MEDIA_NOT_READY');
      const storage = getMediaStorage();
      const url = storage.backend === 'r2'
        ? storage.createPresignedGetUrl(asset.mediaPath, { expiresIn: 900 })
        : storage.resolvePublicUrl(asset.mediaPath);
      if (!url) throw mediaError('Media public URL is not configured.', 503, 'MEDIA_PUBLIC_URL_REQUIRED');
      response.json({ url, expiresIn: storage.backend === 'r2' ? 900 : null });
    } catch (error) {
      response.status(error.status || 500).json({ error: error.message, code: error.code || 'MEDIA_VIEW_URL_FAILED' });
    }
  });

  router.delete('/media/:mediaId', async (request, response) => {
    try {
      const asset = await getMediaAsset(request.params.mediaId, repositories);
      if (!asset) throw mediaError('Media asset not found.', 404, 'MEDIA_NOT_FOUND');
      const storage = getMediaStorage();
      if (storage.backend === 'r2') await storage.delete(asset.mediaPath);
      const deleted = await markMediaAssetDeleted(asset.id, repositories);
      response.json({ asset: deleted });
    } catch (error) {
      response.status(error.status || 500).json({ error: error.message, code: error.code || 'MEDIA_DELETE_FAILED' });
    }
  });

  return router;
}
