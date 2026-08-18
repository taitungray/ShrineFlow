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
import { getBackgroundJobStore } from '../background-jobs.js';

function serializeJobError(error) {
  return {
    message: error?.message || '背景工作失敗。',
    status: error?.status || 500,
    code: error?.code || '',
  };
}

function jobItemsFromAssembled(items = []) {
  return items.map((item) => ({
    source: item.source || '',
    mediaPath: item.mediaPath || '',
    mediaId: item.mediaId || '',
    mimeType: item.mimeType || item.file?.mimetype || '',
    originalName: item.originalName || item.file?.originalname || '',
  }));
}

export function createGenerateRouter({
  aiService,
  aiRateLimiter = createAiRateLimiter(),
  repositories,
  mediaStorage,
  jobStore,
} = {}) {
  const router = Router();
  const reposOf = () => repositories || getRepositories();
  const storageOf = () => mediaStorage || getMediaStorage();
  const jobsOf = () => jobStore || getBackgroundJobStore();

  function presentJob(job) {
    return jobsOf().publicView(job);
  }

  async function settleJob(jobId, runner) {
    try {
      await runner();
    } catch (error) {
      console.error(error);
      jobsOf().update(jobId, { status: 'failed', error: serializeJobError(error) });
    }
  }

  async function runGenerateJob(jobId) {
    const current = jobsOf().update(jobId, { status: 'running' });
    if (!current || current.status !== 'running') return;
    const input = current.input || {};
    const generated = await aiService.generatePostCopy({
      contentTopic: input.contentTopic,
      postType: input.postType,
      extraNotes: input.extraNotes,
      defaultHashtags: input.defaultHashtags,
      files: await hydrateGenerateFiles(input.items || [], { mediaStorage: storageOf() }),
    });
    generated.contentTopic = generated.contentTopic || input.contentTopic;
    generated.godName = generated.godName || input.contentTopic;
    jobsOf().update(jobId, {
      status: 'succeeded',
      result: {
        imagePath: input.mediaPaths?.[0],
        mediaPaths: input.mediaPaths || [],
        originalName: input.originalNames?.[0] || '',
        originalNames: input.originalNames || [],
        defaultHashtags: input.defaultHashtags || '',
        ...generated,
        reusedMediaCount: input.reusedMediaCount || 0,
      },
    });
  }

  async function runRewriteJob(jobId) {
    const current = jobsOf().update(jobId, { status: 'running' });
    if (!current || current.status !== 'running') return;
    const input = current.input || {};
    const rewritten = await aiService.rewritePlatformCopy(input);
    jobsOf().update(jobId, { status: 'succeeded', result: rewritten });
  }

  function readJob(request, response) {
    const job = jobsOf().get(request.params.jobId);
    if (!job) return response.status(404).json({ error: '找不到這項背景工作。', code: 'JOB_NOT_FOUND' });
    if (request.actor && job.clientId) {
      try {
        assertActorPermission(request.actor, job.type === 'rewrite' ? 'content.edit' : 'content.create', job.clientId);
      } catch (error) {
        return response.status(error.status || 403).json({
          error: error.message || 'Permission denied.',
          code: error.code || 'PERMISSION_DENIED',
        });
      }
    }
    return response.json(presentJob(job));
  }

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
    const reusedMediaCount = persistedMedia.filter((file) => file.reused).length;
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
        reusedMediaCount,
      });
    }

    const job = jobsOf().create({
      type: 'generate',
      clientId,
      input: {
        contentTopic,
        postType,
        extraNotes,
        defaultHashtags,
        mediaPaths,
        originalNames,
        reusedMediaCount,
        items: jobItemsFromAssembled(assembled.items),
      },
    });
    response.status(202).json({ jobId: job.id, status: job.status });
    await settleJob(job.id, () => runGenerateJob(job.id));
  });

  router.get('/generate/jobs/:jobId', readJob);
  router.get('/rewrite/jobs/:jobId', readJob);

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

    const clientId = requestedOrAccessibleClientId(request, body.clientId, 'default') || '';
    const job = jobsOf().create({
      type: 'rewrite',
      clientId,
      input: {
        platformId,
        contentType,
        sourceCopy,
        contentTopic: body.contentTopic,
        extraNotes: body.extraNotes,
      },
    });
    response.status(202).json({ jobId: job.id, status: job.status });
    await settleJob(job.id, () => runRewriteJob(job.id));
  });

  return router;
}
