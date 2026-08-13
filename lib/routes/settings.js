import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { getPublicSettings, saveEnvSettings } from '../settings.js';
import { createFacebookPublisher } from '../facebook.js';

export function createSettingsRouter({ onReloadSettings }) {
  const router = Router();

  router.get('/settings', (_request, response) => {
    response.json(getPublicSettings());
  });

  router.post('/settings', async (request, response) => {
    try {
      const body = request.body || {};
      const updatedEnv = await saveEnvSettings({
        GEMINI_API_KEY: body.geminiApiKey,
        GEMINI_MODEL: body.geminiModel,
        GEMINI_FALLBACK_MODELS: body.geminiFallbackModels,
        FACEBOOK_PAGE_ID: body.facebookPageId,
        FACEBOOK_PAGE_ACCESS_TOKEN: body.facebookPageAccessToken,
        META_GRAPH_VERSION: body.metaGraphVersion,
        PUBLIC_MEDIA_BASE_URL: body.publicMediaBaseUrl,
      });

      if (typeof onReloadSettings === 'function') {
        await onReloadSettings(updatedEnv);
      }

      response.json({ message: '系統設定已儲存並成功動態重載。', settings: getPublicSettings() });
    } catch (error) {
      response.status(500).json({ error: error.message || '儲存設定失敗。' });
    }
  });

  router.post('/settings/test-gemini', async (request, response) => {
    const { apiKey, model } = request.body || {};
    const keyToTest = (apiKey && !apiKey.includes('...')) ? apiKey.trim() : (process.env.GEMINI_API_KEY || '');
    const modelToTest = model ? model.trim() : (process.env.GEMINI_MODEL || 'gemini-3.6-flash');

    if (!keyToTest) {
      return response.status(400).json({ success: false, error: '未輸入 Gemini API Key。' });
    }

    try {
      const ai = new GoogleGenAI({ apiKey: keyToTest });
      const res = await ai.models.generateContent({
        model: modelToTest,
        contents: [{ role: 'user', parts: [{ text: '測試連線。請簡短回傳「OK」。' }] }],
      });
      response.json({ success: true, message: `Gemini API Key 驗證成功！（模型：${modelToTest}）`, output: res.text || '' });
    } catch (error) {
      response.status(400).json({ success: false, error: `Gemini 連線失敗：${error.message || '請確認 API Key 是否正確'}` });
    }
  });

  router.post('/settings/test-facebook', async (request, response) => {
    const { pageId, pageAccessToken, graphVersion } = request.body || {};
    const pageIdToTest = pageId ? pageId.trim() : (process.env.FACEBOOK_PAGE_ID || '');
    const tokenToTest = (pageAccessToken && !pageAccessToken.includes('...'))
      ? pageAccessToken.trim()
      : (process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '');
    const versionToTest = graphVersion ? graphVersion.trim() : (process.env.META_GRAPH_VERSION || 'v25.0');

    if (!pageIdToTest || !tokenToTest) {
      return response.status(400).json({ success: false, error: '未完整輸入 Facebook Page ID 或 Access Token。' });
    }

    try {
      const publisher = createFacebookPublisher({
        pageId: pageIdToTest,
        pageAccessToken: tokenToTest,
        graphVersion: versionToTest,
      });
      const page = await publisher.verify();
      response.json({ success: true, message: `Facebook 連線成功！粉專名稱：「${page.name}」（ID: ${page.id}）`, page });
    } catch (error) {
      response.status(400).json({ success: false, error: `Facebook 連線失敗：${error.message || '請確認 Page ID 與 Token 權限'}` });
    }
  });

  return router;
}
