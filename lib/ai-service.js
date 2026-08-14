import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { directories, readJson, jsonFiles } from './store.js';
import { generateWithFallback, describeGeminiError } from './gemini-retry.js';
import { formatCopy } from './copy-format.js';

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
    const buffer = await fs.readFile(file.path);
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
    const legacyProfiles = await readJson(jsonFiles.gods, []);
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

  return {
    get configured() { return Boolean(process.env.GEMINI_API_KEY); },
    provider: 'Gemini',
    get models() {
      reloadConfig();
      return geminiModels;
    },
    reloadConfig,
    generatePostCopy,
  };
}
