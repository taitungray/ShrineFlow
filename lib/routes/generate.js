import { Router } from 'express';
import {
  enforceUploadQuota,
  enforceUploadedFileQuota,
  persistUploadedFiles,
  upload,
} from '../upload.js';
import { requestedOrAccessibleClientId } from '../request-scope.js';
import { assertActorPermission } from '../access-control.js';
import { createAiRateLimiter } from '../ai-rate-limit.js';
import { listMediaAssets } from '../media-assets.js';
import { getRepositories } from '../repositories.js';
import { getMediaStorage } from '../media-storage.js';
import { assembleGenerateMedia, hydrateGenerateFiles } from '../generate-media.js';

export function createGenerateRouter({
  aiService,
  aiRateLimiter = createAiRateLimiter(),
  repositories,
  mediaStorage,
} = {}) {
  const router = Router();
  const reposOf = () => repositories || getRepositories();
  const storageOf = () => mediaStorage || getMediaStorage();

  function assertAiRateLimit(request, response) {
    try {
      aiRateLimiter.assertAllowed(request.actor?.uid || request.ip || 'anonymous');
      return true;
    } catch (error) {
      response.status(error.status || 429).json({
        error: error.message || 'AI 請求過於頻繁，請稍後再試。',
        code: error.code || 'AI_RATE_LIMITED',
      });
      return false;
    }
  }

  router.post('/generate', enforceUploadQuota, upload.array('media'), enforceUploadedFileQuota, async (request, response) => {
    if (!assertAiRateLimit(request, response)) return;
    const body = request.body || {};
    const contentTopic = String(body.contentTopic || body.godName || '').trim();
    const { postType = 'intro', extraNotes = '', defaultHashtags = '' } = body;
    const media = request.files || [];
    if (!contentTopic) return response.status(400).json({ error: '請填寫內容主題或對象。' });
    const clientId = requestedOrAccessibleClientId(request, body.clientId, 'default');
    if (!clientId) return response.status(400).json({ error: 'Client is required.', code: 'CLIENT_REQUIRED' });
    if (request.actor) {
      try {
        request.membership = assertActorPermission(request.actor, 'content.create', clientId);
        request.authorizedClientId = clientId;
      } catch (error) {
        return response.status(error.status || 403).json({
          error: error.message || 'Permission denied.',
          code: error.code || 'PERMISSION_DENIED',
        });
      }
    }
    const persistedMedia = await persistUploadedFiles(media, {
      clientId,
      repositories: reposOf(),
    });
    const assets = await listMediaAssets({ clientId }, reposOf());
    const assembled = assembleGenerateMedia({
      uploaded: persistedMedia,
      sequence: body.mediaSequence,
      existingMediaPaths: body.existingMediaPaths,
      mediaIds: body.mediaIds,
      assets,
      clientId,
    });
    if (assembled.errors.length) {
      return response.status(400).json({
        error: assembled.errors[0].message,
        code: assembled.errors[0].code,
        errors: assembled.errors,
      });
    }
    const mediaPaths = assembled.mediaPaths;
    const originalNames = assembled.items.map((item) => item.originalName || item.file?.originalname || '').filter(Boolean);

    if (!aiService.configured) {
      return response.status(503).json({
        error: '尚未設定 GEMINI_API_KEY。請在 .env 填入從 Google AI Studio 取得的 API Key。',
        imagePath: mediaPaths[0],
        mediaPaths,
      });
    }

    try {
      const generated = await aiService.generatePostCopy({
        contentTopic,
        postType,
        extraNotes,
        defaultHashtags,
        files: await hydrateGenerateFiles(assembled.items, { mediaStorage: storageOf() }),
      });
      generated.contentTopic = generated.contentTopic || contentTopic;
      generated.godName = generated.godName || contentTopic;
      response.json({
        imagePath: mediaPaths[0],
        mediaPaths,
        originalName: originalNames[0] || '',
        originalNames,
        defaultHashtags,
        ...generated,
      });
    } catch (error) {
      console.error(error);
      const status = error.status || 500;
      response.status(status).json({
        error: error.message || 'AI 產文時發生錯誤。',
        imagePath: mediaPaths[0],
        mediaPaths,
      });
    }
  });

  router.post('/rewrite', async (request, response) => {
    if (!assertAiRateLimit(request, response)) return;
    const body = request.body || {};
    const platformId = String(body.platformId || '').trim();
    const contentType = String(body.contentType || 'post').trim() || 'post';
    const sourceCopy = String(body.sourceCopy || '').trim();
    if (!['facebook', 'instagram', 'threads'].includes(platformId) || !sourceCopy) {
      return response.status(400).json({ error: '平台與待改寫的母稿文案為必填。' });
    }
    if (!aiService.configured || typeof aiService.rewritePlatformCopy !== 'function') {
      return response.status(503).json({ error: '尚未設定可用的 AI 改寫服務。' });
    }

    try {
      const rewritten = await aiService.rewritePlatformCopy({
        platformId,
        contentType,
        sourceCopy,
        contentTopic: body.contentTopic,
        extraNotes: body.extraNotes,
      });
      response.json(rewritten);
    } catch (error) {
      response.status(error.status || 500).json({ error: error.message || 'AI 改寫時發生錯誤。' });
    }
  });

  return router;
}
