import { Router } from 'express';
import fs from 'node:fs/promises';
import { GoogleGenAI } from '@google/genai';
import {
  environmentFilePath,
  getPublicSettings,
  rotateEnvironmentContent,
  rotatePersistedSettings,
  saveEnvSettings,
} from '../settings.js';
import { createFacebookPublisher } from '../facebook.js';
import { jsonFiles } from '../store.js';
import { getSecretMasterKey } from '../secret-storage.js';
import { rotateClientSecrets } from '../clients.js';

const ROTATION_MIN_KEY_LENGTH = 16;
const ROTATION_SECRET_ENV_KEYS = ['GEMINI_API_KEY', 'FACEBOOK_PAGE_ACCESS_TOKEN', 'META_APP_SECRET'];

async function createRotationBackup(filePath) {
  try {
    await fs.access(filePath);
    const backupPath = `${filePath}.rotation-backup`;
    await fs.copyFile(filePath, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}

async function restoreRotationBackup(backupPath, filePath) {
  if (!backupPath) return;
  await fs.copyFile(backupPath, filePath).catch(() => {});
}

async function removeRotationBackup(backupPath) {
  if (!backupPath) return;
  await fs.rm(backupPath, { force: true }).catch(() => {});
}

export function createSettingsRouter({ onReloadSettings, repositories } = {}) {
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
      }, { repositories });

      if (typeof onReloadSettings === 'function') {
        await onReloadSettings(updatedEnv);
      }

      response.json({ message: '系統設定已儲存並成功動態重載。', settings: getPublicSettings() });
    } catch (error) {
      response.status(500).json({ error: error.message || '儲存設定失敗。' });
    }
  });

  router.post('/settings/rotate-secrets', async (request, response) => {
    const body = request.body || {};
    const currentMasterKey = String(body.currentMasterKey || '').trim();
    const newMasterKey = String(body.newMasterKey || '').trim();
    const configuredMasterKey = getSecretMasterKey();

    if (configuredMasterKey && currentMasterKey !== configuredMasterKey) {
      return response.status(400).json({ error: 'Current master key verification failed.' });
    }
    if (newMasterKey.length < ROTATION_MIN_KEY_LENGTH) {
      return response.status(400).json({ error: `New master key must be at least ${ROTATION_MIN_KEY_LENGTH} characters.` });
    }
    if (configuredMasterKey && newMasterKey === configuredMasterKey) {
      return response.status(400).json({ error: 'New master key must differ from the current master key.' });
    }

    let clientBackupPath = null;
    let envBackupPath = null;
    const previousProcessSecrets = Object.fromEntries([
      'SHRINEFLOW_MASTER_KEY',
      ...ROTATION_SECRET_ENV_KEYS,
    ].map((key) => [key, process.env[key]]));
    const firestoreSettings = repositories?.backend === 'firestore';
    try {
      clientBackupPath = firestoreSettings ? null : await createRotationBackup(jsonFiles.clients);
      envBackupPath = firestoreSettings ? null : await createRotationBackup(environmentFilePath);
      const currentEnvContent = await fs.readFile(environmentFilePath, 'utf8').catch(() => '');
      const rotatedEnv = rotateEnvironmentContent(currentEnvContent, currentMasterKey, newMasterKey);

      const rotatedClients = await rotateClientSecrets(currentMasterKey, newMasterKey, repositories);
      const persisted = firestoreSettings
        ? await rotatePersistedSettings(currentMasterKey, newMasterKey, { repositories })
        : rotatedEnv.plainEnv;
      if (!firestoreSettings) {
        await fs.writeFile(environmentFilePath, rotatedEnv.content, 'utf8');
      }

      process.env.SHRINEFLOW_MASTER_KEY = newMasterKey;
      for (const key of ROTATION_SECRET_ENV_KEYS) {
        if (persisted[key] !== undefined) process.env[key] = persisted[key];
      }

      if (typeof onReloadSettings === 'function') {
        await onReloadSettings(rotatedEnv.plainEnv);
      }

      return response.json({
        message: 'Secret rotation completed.',
        clientCount: rotatedClients.clientCount,
        settings: getPublicSettings(),
      });
    } catch (error) {
      await restoreRotationBackup(clientBackupPath, jsonFiles.clients);
      await restoreRotationBackup(envBackupPath, environmentFilePath);
      for (const [key, value] of Object.entries(previousProcessSecrets)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      return response.status(500).json({ error: error.message || 'Secret rotation failed.' });
    } finally {
      await removeRotationBackup(clientBackupPath);
      await removeRotationBackup(envBackupPath);
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
