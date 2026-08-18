import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { directories } from './store.js';
import { getRepositories } from './repositories.js';
import { generateWithFallback, describeGeminiError } from './gemini-retry.js';
import { formatCopy } from './copy-format.js';

const PLATFORM_REWRITE_LIMITS = Object.freeze({
  facebook: 5000,
  instagram: 2200,
  threads: 500,
});

const PLATFORM_REWRITE_RULES = Object.freeze({
  facebook: 'Facebook：保留完整資訊與活動重點，可分段，語氣清楚自然。',
  instagram: 'Instagram：突出視覺感受，文字精簡，保留適量 emoji 與 Hashtag 空間，不要像長篇公告。',
  threads: 'Threads：以日常對話與即時互動為主，控制在 500 字內，像真人發文，不要使用過度正式的標題。',
});

export function createAiService() {
  let gemini = null;
  let geminiModels = [];
  let geminiRetryAttempts = 3;
  let geminiRetryBaseMs = 1000;

  function reloadConfig() {
    gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
    const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    geminiModels = [geminiModel, ...(process.env.GEMINI_FALLBACK_MODELS || '').split(',')]
      .map((model) => model.trim())
      .filter((model, index, models) => model && models.indexOf(model) === index);
    geminiRetryAttempts = Math.max(1, Number(process.env.GEMINI_RETRY_ATTEMPTS) || 3);
    geminiRetryBaseMs = Math.max(250, Number(process.env.GEMINI_RETRY_BASE_MS) || 1_000);
  }

  reloadConfig();

  async function loadMediaAsInlineData(file) {
    const buffer = file.buffer || await fs.readFile(file.path);
    return {
      inlineData: {
        data: buffer.toString('base64'),
        mimeType: file.mimetype,
      },
    };
  }

  function parseModelJson(text) {
    const cleaned = text.trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
      throw new Error('AI 回傳格式不是有效 JSON。');
    }
  }

  async function generatePostCopy({ contentTopic = '', godName = '', postType, extraNotes, defaultHashtags, files = [] }) {
    reloadConfig();
    if (!gemini) {
      const error = new Error('尚未設定 GEMINI_API_KEY。請在網頁設定或 .env 填入 API Key。');
      error.status = 503;
      throw error;
    }

   const topic = String(contentTopic || godName || '').trim();
    const legacyProfiles = await getRepositories().gods.list();
   const legacyProfile = legacyProfiles.find((item) => item.name === topic);
    const promptRules = await fs.readFile(path.join(directories.prompts, 'social.txt'), 'utf8');
    const socialPostSchema = JSON.parse(await fs.readFile(path.join(directories.prompts, 'social-schema.json'), 'utf8'));
    const generationContext = JSON.parse(await fs.readFile(path.join(directories.prompts, 'generation-context.json'), 'utf8'));
    const mediaParts = await Promise.all(files.map(loadMediaAsInlineData));
    const labels = generationContext.labels;
    const fallbacks = generationContext.fallbacks;
    const mediaStatus = files.length
      ? fallbacks.mediaWithFiles.replace('{count}', String(files.length))
      : fallbacks.mediaWithoutFiles;
    const context = [
      (labels.contentTopic || labels.godName || '內容主題或對象：') + topic,
      (labels.context || labels.intro || '補充背景：') + (legacyProfile?.intro || fallbacks.intro),
      labels.tags + (legacyProfile?.tags?.join('、') || fallbacks.tags),
      labels.postType + postType,
      labels.notes + (extraNotes.trim() || fallbacks.notes),
      '預設 Hashtag：' + (defaultHashtags.trim() || '無；請自行產生合適標籤。'),
      labels.media + mediaStatus,
    ].join('\n');

    try {
      const { result } = await generateWithFallback({
        models: geminiModels,
        maxAttempts: geminiRetryAttempts,
        baseDelayMs: geminiRetryBaseMs,
        timeoutMs: Math.max(5_000, Number(process.env.GEMINI_TIMEOUT_MS) || 90_000),
        generate: (model) => gemini.models.generateContent({
          model,
          contents: [{
            role: 'user',
            parts: [{ text: context }, ...mediaParts],
          }],
          config: {
            systemInstruction: promptRules,
            responseMimeType: 'application/json',
            responseJsonSchema: socialPostSchema,
          },
        }),
      });
      const generated = parseModelJson(result.text || '');
      generated.facebook = formatCopy(generated.facebook, 'facebook');
      generated.reel = formatCopy(generated.reel, 'reel');
      return generated;
    } catch (error) {
      const described = describeGeminiError(error, geminiModels);
      const err = new Error(described);
      err.status = 502;
      throw err;
    }
  }

  async function rewritePlatformCopy({
    platformId = '',
    contentType = 'post',
    sourceCopy = '',
    contentTopic = '',
    extraNotes = '',
  } = {}) {
    reloadConfig();
    if (!gemini) {
      const error = new Error('尚未設定 GEMINI_API_KEY。請先在設定頁完成 AI 憑證設定。');
      error.status = 503;
      throw error;
    }

    const platform = String(platformId || '').trim();
    const source = String(sourceCopy || '').trim().slice(0, 4000);
    const limit = PLATFORM_REWRITE_LIMITS[platform];
    if (!limit || !source) {
      const error = new Error('平台與待改寫的母稿文案為必填。');
      error.status = 400;
      throw error;
    }

    const context = [
      `平台：${platform}`,
      `內容格式：${contentType}`,
      `主題：${String(contentTopic || '').trim().slice(0, 200)}`,
      `補充要求：${String(extraNotes || '').trim().slice(0, 1000) || '無'}`,
      `平台策略：${PLATFORM_REWRITE_RULES[platform]}`,
      `字數上限：${limit}`,
      '請只改寫文案，不要新增不存在的事實、日期、價格或連結。',
      `母稿：\n${source}`,
    ].join('\n');

    try {
      const { result } = await generateWithFallback({
        models: geminiModels,
        maxAttempts: geminiRetryAttempts,
        baseDelayMs: geminiRetryBaseMs,
        timeoutMs: Math.max(5_000, Number(process.env.GEMINI_TIMEOUT_MS) || 90_000),
        generate: (model) => gemini.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: context }] }],
          config: {
            systemInstruction: '你是多平台社群文案編輯。請回傳 JSON：{"copy":"改寫後文案"}，不要輸出 Markdown 或其他欄位。',
            responseMimeType: 'application/json',
            responseJsonSchema: {
              type: 'object',
              properties: { copy: { type: 'string' } },
              required: ['copy'],
              additionalProperties: false,
            },
          },
        }),
      });
      const generated = parseModelJson(result.text || '');
      const formatted = formatCopy(String(generated.copy || '').slice(0, limit), contentType === 'reel' ? 'reel' : 'facebook');
      if (!formatted) throw new Error('AI 未產生可用的改寫文案。');
      return { platformId: platform, contentType, copy: formatted.slice(0, limit), source: 'ai_rewrite' };
    } catch (error) {
      const described = describeGeminiError(error, geminiModels);
      const err = new Error(described);
      err.status = 502;
      throw err;
    }
  }

  return {
    get configured() { return Boolean(process.env.GEMINI_API_KEY); },
    provider: 'Gemini',
    get models() {
      reloadConfig();
      return geminiModels;
    },
    reloadConfig,
    generatePostCopy,
    rewritePlatformCopy,
  };
}
