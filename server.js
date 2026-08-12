import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createFacebookPublisher, FacebookPublishError } from './lib/facebook.js';
import { formatCopy, normalizePostCopy } from './lib/copy-format.js';
import { describeGeminiError, generateWithFallback } from './lib/gemini-retry.js';
import { getContentType, getPublishingPlatforms } from './lib/platforms.js';
import { findPlatformAccount, getPlatformAccounts } from './lib/platform-accounts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 3000);

const directories = {
  data: path.join(__dirname, 'data'),
  uploads: path.join(__dirname, 'uploads'),
  prompts: path.join(__dirname, 'prompts'),
};

const jsonFiles = {
  gods: path.join(directories.data, 'gods.json'),
  posts: path.join(directories.data, 'posts.json'),
  schedule: path.join(directories.data, 'schedule.json'),
};

for (const directory of Object.values(directories)) {
  await fs.mkdir(directory, { recursive: true });
}

async function ensureJsonFile(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(fallback, null, 2), 'utf8');
  }
}

await ensureJsonFile(jsonFiles.gods, []);
await ensureJsonFile(jsonFiles.posts, []);
await ensureJsonFile(jsonFiles.schedule, []);

async function readJson(filePath, fallback = []) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  const temporaryPath = filePath + '.tmp';
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temporaryPath, filePath);
}

function makeId() {
  return Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, directories.uploads),
  filename: (_request, file, callback) => {
    const safeName = path.basename(file.originalname).replace(/[^\w.\-\u00C0-\uFFFF]+/g, '_');
    callback(null, Date.now() + '-' + (safeName || 'image'));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) callback(null, true);
    else callback(new Error('目前只接受圖片或影片檔案。'));
  },
});

const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const geminiModels = [geminiModel, ...(process.env.GEMINI_FALLBACK_MODELS || '').split(',')]
  .map((model) => model.trim())
  .filter((model, index, models) => model && models.indexOf(model) === index);
const geminiRetryAttempts = Math.max(1, Number(process.env.GEMINI_RETRY_ATTEMPTS) || 3);
const geminiRetryBaseMs = Math.max(250, Number(process.env.GEMINI_RETRY_BASE_MS) || 1_000);
const facebookPublisher = createFacebookPublisher({
  pageId: process.env.FACEBOOK_PAGE_ID,
  pageAccessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
  graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
  graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
});
const publishingPlatforms = getPublishingPlatforms(facebookPublisher.configured);
const publishingAccounts = getPlatformAccounts({
  facebookPageId: process.env.FACEBOOK_PAGE_ID || '',
  facebookConfigured: facebookPublisher.configured,
});
const schedulerIntervalMs = Math.max(5_000, Number(process.env.FACEBOOK_SCHEDULER_INTERVAL_MS) || 30_000);
const schedulerMaxAttempts = Math.max(1, Number(process.env.FACEBOOK_SCHEDULER_MAX_ATTEMPTS) || 3);
const schedulerRetryBaseMs = Math.max(5_000, Number(process.env.FACEBOOK_SCHEDULER_RETRY_BASE_MS) || 60_000);
const jsonMutationQueues = new Map();

function mutateJson(filePath, mutator, fallback = []) {
  const previous = jsonMutationQueues.get(filePath) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const value = await readJson(filePath, fallback);
    const result = await mutator(value);
    await writeJson(filePath, value);
    return result;
  });
  jsonMutationQueues.set(filePath, operation);
  return operation;
}

function resolvePostMediaPaths(post) {
  const mediaPaths = Array.isArray(post.mediaPaths) && post.mediaPaths.length
    ? post.mediaPaths
    : (post.imagePath ? [post.imagePath] : []);
  return mediaPaths
    .filter((mediaPath) => String(mediaPath).startsWith('/uploads/'))
    .map((mediaPath) => path.join(directories.uploads, path.basename(String(mediaPath))));
}

async function publishPostToFacebook(post) {
  return facebookPublisher.publish(normalizePostCopy(post), { mediaFilePaths: resolvePostMediaPaths(post) });
}

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
const staticOptions = process.env.NODE_ENV === 'production' ? undefined : {
  setHeaders: (response) => response.setHeader('Cache-Control', 'no-store'),
};
app.use(express.static(path.join(__dirname, 'public'), staticOptions));
app.use('/uploads', express.static(directories.uploads, staticOptions));


app.get('/api/config', (_request, response) => {
  response.json({
    aiConfigured: Boolean(gemini),
    provider: 'Gemini',
    model: geminiModels.join(', '),
    facebookConfigured: facebookPublisher.configured,
    facebookPageId: process.env.FACEBOOK_PAGE_ID || '',
    facebookSchedulerIntervalSeconds: schedulerIntervalMs / 1000,
    publishingPlatforms,
    publishingAccounts,
  });
});

app.get('/api/accounts', (_request, response) => {
  response.json(publishingAccounts);
});

app.get('/api/facebook/status', async (_request, response) => {
  if (!facebookPublisher.configured) return response.json({ configured: false, connected: false });
  try {
    const page = await facebookPublisher.verify();
    response.json({ configured: true, connected: true, page });
  } catch (error) {
    response.status(502).json({
      configured: true,
      connected: false,
      error: error.message || '無法驗證 Facebook 粉專連線。',
    });
  }
});

app.get('/api/gods', async (_request, response) => {
  response.json(await readJson(jsonFiles.gods, []));
});

app.post('/api/gods', async (request, response) => {
  const { name, tags = [], intro = '' } = request.body || {};
  if (!name || !name.trim()) return response.status(400).json({ error: '請填寫神明名稱。' });
  const gods = await readJson(jsonFiles.gods, []);
  if (gods.some((god) => god.name === name.trim())) {
    return response.status(409).json({ error: '這個神明已經存在。' });
  }
  const god = { name: name.trim(), tags, intro: intro.trim() };
  gods.push(god);
  await writeJson(jsonFiles.gods, gods);
  response.status(201).json(god);
});

app.get('/api/posts', async (_request, response) => {
  const posts = await readJson(jsonFiles.posts, []);
  response.json(posts.map(normalizePostCopy).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.get('/api/schedule', async (_request, response) => {
  const schedule = await readJson(jsonFiles.schedule, []);
  response.json(schedule.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)));
});

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

app.post('/api/generate', upload.array('media', 10), async (request, response) => {
  const { godName = '', postType = 'work', extraNotes = '', defaultHashtags = '' } = request.body || {};
  const media = request.files || [];
  if (!godName.trim()) return response.status(400).json({ error: '請填寫神明名稱。' });
  const mediaPaths = media.map((file) => '/uploads/' + file.filename);
  if (!gemini) {
    return response.status(503).json({
      error: '尚未設定 GEMINI_API_KEY。請在 .env 填入從 Google AI Studio 取得的 API Key。',
      imagePath: mediaPaths[0],
      mediaPaths,
    });
  }

  const gods = await readJson(jsonFiles.gods, []);
  const god = gods.find((item) => item.name === godName.trim());
  const promptRules = await fs.readFile(path.join(directories.prompts, 'social.txt'), 'utf8');
  const socialPostSchema = JSON.parse(await fs.readFile(path.join(directories.prompts, 'social-schema.json'), 'utf8'));
  const generationContext = JSON.parse(await fs.readFile(path.join(directories.prompts, 'generation-context.json'), 'utf8'));
  const mediaParts = await Promise.all(media.map(loadMediaAsInlineData));
  const labels = generationContext.labels;
  const fallbacks = generationContext.fallbacks;
  const mediaStatus = media.length
    ? fallbacks.mediaWithFiles.replace('{count}', String(media.length))
    : fallbacks.mediaWithoutFiles;
  const context = [
    labels.godName + godName.trim(),
    labels.intro + (god?.intro || fallbacks.intro),
    labels.tags + (god?.tags?.join('、') || fallbacks.tags),
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
          parts: [
            { text: context },
            ...mediaParts,
          ],
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
    response.status(502).json({
      error: describeGeminiError(error, geminiModels),
      imagePath: mediaPaths[0],
      mediaPaths,
    });
  }
});

app.post('/api/posts', async (request, response) => {
  const body = request.body || {};
  if (!body.godName || !body.facebook || !body.facebook.trim()) {
    return response.status(400).json({ error: '至少需要神明名稱與 Facebook 文案。' });
  }
  const post = {
    id: makeId(),
    createdAt: new Date().toISOString(),
    status: 'draft',
    godName: body.godName.trim(),
    postType: body.postType || 'work',
    extraNotes: body.extraNotes || '',
    channel: body.channel || 'facebook',
    accountId: body.accountId || '',
    contentType: body.contentType || 'post',
    contentSettings: body.contentSettings && typeof body.contentSettings === 'object' ? body.contentSettings : {},
    imagePath: body.imagePath || '',
    mediaPaths: Array.isArray(body.mediaPaths) && body.mediaPaths.length
      ? body.mediaPaths
      : (body.imagePath ? [body.imagePath] : []),
    facebook: formatCopy(body.facebook, 'facebook'),
    reel: formatCopy(body.reel, 'reel'),
    hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
    imageDescription: body.imageDescription || '',
  };
  await mutateJson(jsonFiles.posts, (posts) => posts.push(post));
  response.status(201).json(post);
});

app.patch('/api/posts/:postId', async (request, response) => {
  const updates = { ...request.body };
  if (Object.prototype.hasOwnProperty.call(updates, 'facebook')) updates.facebook = formatCopy(updates.facebook, 'facebook');
  if (Object.prototype.hasOwnProperty.call(updates, 'reel')) updates.reel = formatCopy(updates.reel, 'reel');
  const updated = await mutateJson(jsonFiles.posts, (posts) => {
    const index = posts.findIndex((post) => post.id === request.params.postId);
    if (index < 0) return null;
    posts[index] = { ...posts[index], ...updates, id: posts[index].id, updatedAt: new Date().toISOString() };
    return normalizePostCopy(posts[index]);
  });
  if (!updated) return response.status(404).json({ error: '找不到這篇貼文。' });
  response.json(updated);
});

app.post('/api/schedule', async (request, response) => {
  const { postId, scheduledAt, channel = 'facebook', accountId = '', contentType = 'post', contentSettings = {} } = request.body || {};
  if (!postId || !scheduledAt) return response.status(400).json({ error: '請選擇貼文與排程時間。' });
  const platform = publishingPlatforms.find((item) => item.id === channel);
  if (!platform) return response.status(400).json({ error: '不支援的發布平台。' });
  if (!platform.enabled) return response.status(400).json({ error: `${platform.name} 尚未串接，請先選擇已啟用的平台。` });
  const selectedContentType = getContentType(channel, contentType);
  if (!selectedContentType || selectedContentType.id !== contentType) return response.status(400).json({ error: '不支援的發布格式。' });
  if (!selectedContentType.canPublish) return response.status(400).json({ error: `${platform.name} 的「${selectedContentType.name}」尚未串接發布功能，目前先提供版型規劃。` });
  const selectedAccount = findPlatformAccount(publishingAccounts, accountId || `facebook:${process.env.FACEBOOK_PAGE_ID || 'default'}`);
  if (!selectedAccount || selectedAccount.platformId !== channel) return response.status(400).json({ error: '請選擇與發布平台相符的帳號。' });
  if (!selectedAccount.enabled) return response.status(400).json({ error: `${selectedAccount.name} 尚未連接，請先完成帳號設定。` });
  if (Number.isNaN(new Date(scheduledAt).getTime())) return response.status(400).json({ error: '排程時間格式不正確。' });
  const posts = await readJson(jsonFiles.posts, []);
  const scheduledPost = posts.find((post) => post.id === postId);
  if (!scheduledPost) return response.status(404).json({ error: '找不到要排程的貼文。' });
  const scheduledMedia = Array.isArray(scheduledPost.mediaPaths) && scheduledPost.mediaPaths.length
    ? scheduledPost.mediaPaths
    : (scheduledPost.imagePath ? [scheduledPost.imagePath] : []);
  const scheduledVideos = scheduledMedia.filter((mediaPath) => /\.(avi|m4v|mov|mp4|mpeg|mpg|ogv|webm)$/i.test(mediaPath));
  if (scheduledVideos.length && scheduledMedia.length !== 1) {
    return response.status(400).json({ error: 'Facebook 排程支援多張圖片或單一影片，暫不支援圖片與影片混合發布。' });
  }
  const item = { id: makeId(), postId, scheduledAt, channel, accountId: selectedAccount.id, contentType, contentSettings: contentSettings && typeof contentSettings === 'object' ? contentSettings : {}, status: 'pending', createdAt: new Date().toISOString() };
  const created = await mutateJson(jsonFiles.schedule, (schedule) => {
    const duplicate = schedule.some((entry) => (
      entry.postId === postId
      && entry.channel === channel
      && entry.accountId === selectedAccount.id
      && entry.contentType === contentType
      && ['pending', 'publishing', 'retrying'].includes(entry.status)
    ));
    if (duplicate) return false;
    schedule.push(item);
    return true;
  });
  if (!created) return response.status(409).json({ error: '這篇貼文已經有相同平台與帳號的尚未完成排程。' });
  response.status(201).json(item);
});

app.post('/api/publish/facebook', async (request, response) => {
  if (!facebookPublisher.configured) {
    return response.status(503).json({
      error: 'Facebook 尚未設定。請在 .env 填入 FACEBOOK_PAGE_ID 與 FACEBOOK_PAGE_ACCESS_TOKEN。',
    });
  }
  const posts = await readJson(jsonFiles.posts, []);
  const post = posts.find((item) => item.id === request.body?.postId);
  if (!post) return response.status(404).json({ error: '找不到要發布的貼文。' });

  try {
    const result = await publishPostToFacebook(post);
    const publishedAt = new Date().toISOString();
    await mutateJson(jsonFiles.posts, (records) => {
      const target = records.find((item) => item.id === post.id);
      if (target) Object.assign(target, { status: 'published', publishedAt, facebookPostId: result.externalId });
    });
    response.json({ ...result, publishedAt });
  } catch (error) {
    const status = error instanceof FacebookPublishError && error.status ? 502 : 500;
    response.status(status).json({ error: error.message || 'Facebook 發布失敗。' });
  }
});

let schedulerRunning = false;

async function claimDueSchedule(now = new Date()) {
  return mutateJson(jsonFiles.schedule, (schedule) => {
    const item = schedule.find((entry) => {
      if (!['pending', 'retrying'].includes(entry.status) || entry.channel !== 'facebook') return false;
      const dueAt = entry.status === 'retrying' ? entry.nextAttemptAt : entry.scheduledAt;
      return dueAt && new Date(dueAt) <= now;
    });
    if (!item) return null;
    item.status = 'publishing';
    item.attempts = Number(item.attempts || 0) + 1;
    item.lastAttemptAt = now.toISOString();
    delete item.nextAttemptAt;
    return { ...item };
  });
}

async function finishSchedule(scheduleItem, result) {
  const publishedAt = new Date().toISOString();
  await mutateJson(jsonFiles.schedule, (schedule) => {
    const item = schedule.find((entry) => entry.id === scheduleItem.id);
    if (!item) return;
    Object.assign(item, {
      status: 'published',
      publishedAt,
      facebookPostId: result.externalId,
      facebookPhotoId: result.photoId,
      facebookPhotoIds: result.photoIds,
      facebookVideoId: result.videoId,
    });
    delete item.lastError;
  });
  await mutateJson(jsonFiles.posts, (posts) => {
    const post = posts.find((entry) => entry.id === scheduleItem.postId);
    if (post) Object.assign(post, { status: 'published', publishedAt, facebookPostId: result.externalId });
  });
}

async function failSchedule(scheduleItem, error) {
  const shouldRetry = Boolean(error?.retriable) && scheduleItem.attempts < schedulerMaxAttempts;
  const retryDelay = schedulerRetryBaseMs * (2 ** Math.max(0, scheduleItem.attempts - 1));
  await mutateJson(jsonFiles.schedule, (schedule) => {
    const item = schedule.find((entry) => entry.id === scheduleItem.id);
    if (!item) return;
    item.status = shouldRetry ? 'retrying' : 'failed';
    item.lastError = {
      message: error?.message || 'Facebook 發布失敗。',
      code: error?.code,
      subcode: error?.subcode,
      traceId: error?.traceId,
      at: new Date().toISOString(),
    };
    if (shouldRetry) item.nextAttemptAt = new Date(Date.now() + retryDelay).toISOString();
  });
}

async function processDueSchedules() {
  if (schedulerRunning || !facebookPublisher.configured) return;
  schedulerRunning = true;
  try {
    for (let processed = 0; processed < 10; processed += 1) {
      const scheduleItem = await claimDueSchedule();
      if (!scheduleItem) break;
      try {
        const posts = await readJson(jsonFiles.posts, []);
        const post = posts.find((entry) => entry.id === scheduleItem.postId);
        if (!post) throw new FacebookPublishError('排程所屬的草稿已不存在。');
        const result = await publishPostToFacebook(post);
        await finishSchedule(scheduleItem, result);
        console.log(`Facebook post published: ${result.externalId}`);
      } catch (error) {
        console.error('Facebook scheduled publish failed:', error);
        await failSchedule(scheduleItem, error);
      }
    }
  } finally {
    schedulerRunning = false;
  }
}

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(400).json({ error: error.message || '請求處理失敗。' });
});

const server = app.listen(port, () => {
  console.log('Social AI Editor running at http://localhost:' + port);
  if (facebookPublisher.configured) {
    console.log(`Facebook scheduler enabled for Page ${process.env.FACEBOOK_PAGE_ID}.`);
    processDueSchedules().catch((error) => console.error('Facebook scheduler failed:', error));
  } else {
    console.log('Facebook scheduler disabled: credentials are not configured.');
  }
});

const schedulerTimer = setInterval(
  () => processDueSchedules().catch((error) => console.error('Facebook scheduler failed:', error)),
  schedulerIntervalMs,
);
schedulerTimer.unref?.();

export { app, server, processDueSchedules };
