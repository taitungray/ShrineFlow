import { Router } from 'express';
import { upload } from '../upload.js';

export function createGenerateRouter({ aiService }) {
  const router = Router();

  router.post('/generate', upload.array('media'), async (request, response) => {
    const body = request.body || {};
    const contentTopic = String(body.contentTopic || body.godName || '').trim();
    const { postType = 'intro', extraNotes = '', defaultHashtags = '' } = body;
    const media = request.files || [];
    if (!contentTopic) return response.status(400).json({ error: '請填寫內容主題或對象。' });
    const mediaPaths = media.map((file) => '/uploads/' + file.filename);

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
        files: media,
      });
      generated.contentTopic = generated.contentTopic || contentTopic;
      generated.godName = generated.godName || contentTopic;
      response.json({
        imagePath: mediaPaths[0],
        mediaPaths,
        originalName: media[0]?.originalname || '',
        originalNames: media.map((file) => file.originalname),
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

  return router;
}
