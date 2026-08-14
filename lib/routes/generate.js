import { Router } from 'express';
import {
  enforceUploadQuota,
  enforceUploadedFileQuota,
  persistUploadedFiles,
  upload,
} from '../upload.js';

export function createGenerateRouter({ aiService }) {
  const router = Router();

  router.post('/generate', enforceUploadQuota, upload.array('media'), enforceUploadedFileQuota, async (request, response) => {
    const body = request.body || {};
    const contentTopic = String(body.contentTopic || body.godName || '').trim();
    const { postType = 'intro', extraNotes = '', defaultHashtags = '' } = body;
    const media = request.files || [];
    if (!contentTopic) return response.status(400).json({ error: '請填寫內容主題或對象。' });
    const persistedMedia = await persistUploadedFiles(media, {
      clientId: String(body.clientId || 'default').trim() || 'default',
    });
    const mediaPaths = persistedMedia.map((file) => file.mediaPath || ('/uploads/' + file.filename));

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
        files: persistedMedia,
      });
      generated.contentTopic = generated.contentTopic || contentTopic;
      generated.godName = generated.godName || contentTopic;
      response.json({
        imagePath: mediaPaths[0],
        mediaPaths,
        originalName: persistedMedia[0]?.originalname || '',
        originalNames: persistedMedia.map((file) => file.originalname),
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
