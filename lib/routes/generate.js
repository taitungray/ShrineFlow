import { Router } from 'express';
import { upload } from '../upload.js';

export function createGenerateRouter({ aiService }) {
  const router = Router();

  router.post('/generate', upload.array('media'), async (request, response) => {
    const { godName = '', postType = 'work', extraNotes = '', defaultHashtags = '' } = request.body || {};
    const media = request.files || [];
    if (!godName.trim()) return response.status(400).json({ error: '請填寫神明名稱。' });
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
        godName,
        postType,
        extraNotes,
        defaultHashtags,
        files: media,
      });
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
