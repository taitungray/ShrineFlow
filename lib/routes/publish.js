import { Router } from 'express';
import { bumpPostVersion } from '../post-version.js';
import { readJson, mutateJson, jsonFiles } from '../store.js';
import { resolvePostMediaPaths } from '../upload.js';
import { normalizePostCopy } from '../copy-format.js';
import { createFacebookPublisher, FacebookPublishError } from '../facebook.js';
import { InstagramPublishError } from '../instagram.js';
import { ThreadsPublishError } from '../threads.js';
import { getClientRaw, findAccount } from '../clients.js';
import {
  migrateLegacyPost,
  resolveTargetCopy,
  resolveTargetMedia,
  summarizePostStatus,
} from '../post-targets.js';
import {
  appendPublishAttempt,
  createPublishAttempt,
  serializePublishError,
  updatePublishAttempt,
} from '../publish-reliability.js';
import {
  findPublishAttemptByIdempotencyKey,
  recordPublishAttemptEvent,
} from '../publish-attempt-log.js';
import path from 'node:path';
import { directories } from '../store.js';
import { formatValidationError, validateTargetFormat } from '../content-validation.js';
import { appendPostVersion } from '../post-history.js';

function mediaFilePathsFromWebPaths(mediaPaths = []) {
  return mediaPaths
    .filter((mediaPath) => String(mediaPath).startsWith('/uploads/'))
    .map((mediaPath) => path.join(directories.uploads, path.basename(String(mediaPath))));
}

function unavailablePublisherError(platformId) {
  const names = {
    facebook: 'Facebook',
    instagram: 'Instagram',
    threads: 'Threads',
  };
  const error = new Error(`${names[platformId] || platformId} 尚未設定。請先填入平台發布憑證。`);
  error.status = 503;
  return error;
}

function isPublicMediaConfigurationError(error) {
  return (
    error instanceof InstagramPublishError
    || error instanceof ThreadsPublishError
  ) && /PUBLIC_MEDIA_BASE_URL|公開網址/i.test(String(error.message || ''));
}

function publishConflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

async function beginPublishAttempt({ postId, targetId, source, idempotencyKey }) {
  const archivedAttempt = await findPublishAttemptByIdempotencyKey({
    postId,
    targetId,
    idempotencyKey,
  });
  return mutateJson(jsonFiles.posts, (records) => {
    const postRaw = records.find((item) => item.id === postId);
    if (!postRaw) {
      const error = new Error('找不到要發布的內容。');
      error.status = 404;
      throw error;
    }

    const post = migrateLegacyPost(postRaw, postRaw.clientId || '');
    const target = (post.targets || []).find((item) => item.id === targetId)
      || (post.targets?.length === 1 ? post.targets[0] : null);
    if (!target) {
      const error = new Error('找不到要發布的平台目標。');
      error.status = 400;
      throw error;
    }

    const existingAttempt = idempotencyKey
      ? (target.publishAttempts || []).find((item) => item.idempotencyKey === idempotencyKey) || archivedAttempt
      : null;
    if (existingAttempt) {
      if (
        existingAttempt.status === 'succeeded'
        && target.status === 'published'
        && (!existingAttempt.externalId || target.externalId === existingAttempt.externalId)
      ) {
        return { replay: true, post, target, attempt: existingAttempt };
      }
      throw publishConflict('此發布請求已經處理過，請使用新的請求識別碼。');
    }

    if (target.status === 'published') {
      throw publishConflict('此平台目標已發布，請建立副本後再重新發布。');
    }
    if (['scheduled', 'pending', 'publishing'].includes(target.status)) {
      throw publishConflict('此平台目標目前正在排程或發布中，請先完成目前流程。');
    }

    const attempt = createPublishAttempt({ source, idempotencyKey });
    target.status = 'publishing';
    target.attempts = Number(target.attempts || 0) + 1;
    target.lastAttemptAt = attempt.startedAt;
    target.lastError = null;
    appendPublishAttempt(target, attempt);
    post.status = summarizePostStatus(post.targets);
    bumpPostVersion(post);
    Object.assign(postRaw, post);
    return { replay: false, post, target, attempt };
  });
}

async function resolvePublisher({
  post,
  target,
  account,
  fallbackPublisher,
  resolveFacebookPublisher,
  resolveInstagramPublisher,
  resolveThreadsPublisher,
}) {
  const context = {
    clientId: post.clientId,
    accountId: target.accountId,
    post,
    target,
    account,
  };

  if (target.platformId === 'facebook') {
    if (resolveFacebookPublisher) return resolveFacebookPublisher(context);
    if (account?.credentials?.pageId && account?.credentials?.pageAccessToken) {
      return createFacebookPublisher({
        pageId: account.credentials.pageId,
        pageAccessToken: account.credentials.pageAccessToken,
        graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
        graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
      });
    }
    return fallbackPublisher;
  }
  if (target.platformId === 'instagram') {
    return resolveInstagramPublisher?.(context);
  }
  if (target.platformId === 'threads') {
    return resolveThreadsPublisher?.(context);
  }

  const error = new Error('不支援的發布平台。');
  error.status = 400;
  throw error;
}

async function publishTarget({
  postId,
  targetId,
  expectedPlatformId,
  source = 'manual',
  idempotencyKey = '',
  fallbackPublisher,
  resolveFacebookPublisher,
  resolveInstagramPublisher,
  resolveThreadsPublisher,
}) {
  const posts = await readJson(jsonFiles.posts, []);
  const postRaw = posts.find((item) => item.id === postId);
  if (!postRaw) {
    const error = new Error('找不到要發布的貼文。');
    error.status = 404;
    throw error;
  }

  const postCandidate = migrateLegacyPost(postRaw, postRaw.clientId || '');
  let targetCandidate = (postCandidate.targets || []).find((item) => item.id === targetId);
  if (!targetCandidate && postCandidate.targets?.length === 1) targetCandidate = postCandidate.targets[0];
  if (!targetCandidate) {
    targetCandidate = (postCandidate.targets || []).find(
      (item) => item.platformId === (expectedPlatformId || 'facebook'),
    ) || null;
  }
  if (!targetCandidate || (expectedPlatformId && targetCandidate.platformId !== expectedPlatformId)) {
    const platformName = expectedPlatformId === 'facebook' ? ' Facebook' : '';
    const error = new Error(`找不到可發布的${platformName}目標。`);
    error.status = 400;
    throw error;
  }

  const attemptClaim = await beginPublishAttempt({
    postId,
    targetId: targetCandidate.id,
    source,
    idempotencyKey,
  });
  if (attemptClaim.replay) {
    return {
      externalId: attemptClaim.attempt.externalId,
      publishedAt: attemptClaim.attempt.finishedAt,
      targetId: attemptClaim.target.id,
      replayed: true,
    };
  }

  const post = attemptClaim.post;
  const target = attemptClaim.target;
  const attemptId = attemptClaim.attempt.id;
  await recordPublishAttemptEvent({
    postId: post.id,
    targetId: target.id,
    platformId: target.platformId,
    attempt: attemptClaim.attempt,
    eventType: 'started',
    occurredAt: attemptClaim.attempt.startedAt,
  });

  const client = await getClientRaw(post.clientId);
  const account = findAccount(client, target.accountId);
  const publisher = await resolvePublisher({
    post,
    target,
    account,
    fallbackPublisher,
    resolveFacebookPublisher,
    resolveInstagramPublisher,
    resolveThreadsPublisher,
  });

  if (!publisher?.configured) {
    throw unavailablePublisherError(target.platformId);
  }

  const copy = resolveTargetCopy(post, target);
  const publishPost = normalizePostCopy({
    ...post,
    facebook: target.contentType === 'reel' ? post.facebook : copy,
    reel: target.contentType === 'reel' ? copy : post.reel,
  });
  const mediaPaths = resolveTargetMedia(post, target);
  const resolvedContentType = (() => {
    if (target.platformId === 'instagram') {
      const contentType = String(target.contentType || '').trim();
      return !contentType || contentType === 'post' ? 'feed' : contentType;
    }
    return target.contentType || 'post';
  })();
  const publishOptions = {
    contentType: resolvedContentType,
    contentSettings: target.contentSettings || {},
  };
  if (target.platformId === 'facebook') {
    publishOptions.mediaFilePaths = mediaPaths.length
      ? mediaFilePathsFromWebPaths(mediaPaths)
      : resolvePostMediaPaths(post);
  } else {
    publishOptions.mediaWebPaths = mediaPaths;
  }
  const validation = await validateTargetFormat({
    platformId: target.platformId,
    contentType: resolvedContentType,
    copy,
    mediaPaths,
    targetId: target.id,
    uploadsDirectory: directories.uploads,
  });
  if (!validation.valid) throw formatValidationError(validation);
  const result = await publisher.publish(publishPost, publishOptions);

  const publishedAt = new Date().toISOString();
  const finalizedPost = await mutateJson(jsonFiles.posts, (records) => {
    const current = records.find((item) => item.id === post.id);
    if (!current) return null;
    const migrated = migrateLegacyPost(current, current.clientId || post.clientId);
    Object.assign(current, migrated);
    const currentTarget = (current.targets || []).find((item) => item.id === target.id);
    if (currentTarget) {
      Object.assign(currentTarget, {
        status: 'published',
        publishedAt,
        externalId: result.externalId,
        lastError: null,
      });
      updatePublishAttempt(currentTarget, attemptId, {
        status: 'succeeded',
        finishedAt: publishedAt,
        externalId: result.externalId,
      });
    }
    current.status = summarizePostStatus(current.targets);
    bumpPostVersion(current);
    current.publishedAt = publishedAt;
    if (target.platformId === 'facebook') {
      current.facebookPostId = result.externalId;
    }
    return current;
  });

  if (finalizedPost) await appendPostVersion({ post: finalizedPost, source: 'publish' });

  await recordPublishAttemptEvent({
    postId: post.id,
    targetId: target.id,
    platformId: target.platformId,
    attempt: {
      ...attemptClaim.attempt,
      status: 'succeeded',
      finishedAt: publishedAt,
      externalId: result.externalId,
    },
    eventType: 'succeeded',
    occurredAt: publishedAt,
  });

  return { ...result, publishedAt, targetId: target.id };
}

async function markTargetPublishFailure(postId, targetId, error) {
  if (!postId || !targetId) return;
  const failure = await mutateJson(jsonFiles.posts, (records) => {
    const current = records.find((item) => item.id === postId);
    if (!current) return;
    const migrated = migrateLegacyPost(current, current.clientId || '');
    Object.assign(current, migrated);
    const currentTarget = (current.targets || []).find((item) => item.id === targetId);
    if (!currentTarget || currentTarget.status !== 'publishing') return null;
    const lastError = serializePublishError(error);
    currentTarget.status = 'failed';
    currentTarget.lastError = lastError;
    updatePublishAttempt(currentTarget, currentTarget.lastAttemptId, {
      status: 'failed',
      finishedAt: lastError.at,
      error: lastError,
    });
    delete currentTarget.nextAttemptAt;
    current.status = summarizePostStatus(current.targets);
    bumpPostVersion(current);
    return {
      postId: current.id,
      targetId: currentTarget.id,
      platformId: currentTarget.platformId,
      attempt: currentTarget.publishAttempts?.find((item) => item.id === currentTarget.lastAttemptId),
      occurredAt: lastError.at,
    };
  });
  if (failure?.attempt) {
    await recordPublishAttemptEvent({
      ...failure,
      eventType: 'failed',
    });
  }
}

export function createPublishRouter({
  facebookPublisher,
  resolveFacebookPublisher,
  resolveInstagramPublisher,
  resolveThreadsPublisher,
} = {}) {
  const router = Router();

  router.post('/publish/target', async (request, response) => {
    const postId = request.body?.postId;
    const targetId = request.body?.targetId;
    const source = String(request.body?.source || 'manual');
    const idempotencyKey = String(request.get('Idempotency-Key') || request.body?.idempotencyKey || '').trim();
    try {
      const result = await publishTarget({
        postId,
        targetId,
        source,
        idempotencyKey,
        fallbackPublisher: facebookPublisher,
        resolveFacebookPublisher,
        resolveInstagramPublisher,
        resolveThreadsPublisher,
      });
      response.json(result);
    } catch (error) {
      await markTargetPublishFailure(postId, targetId, error).catch(() => {});
      if (error.status === 404 || error.status === 400 || error.status === 409 || error.status === 503) {
        return response.status(error.status).json({ error: error.message });
      }
      const status = isPublicMediaConfigurationError(error)
        ? 400
        : error instanceof FacebookPublishError
        || error instanceof InstagramPublishError
        || error instanceof ThreadsPublishError
          ? 502
          : 500;
      response.status(status).json({ error: error.message || '發布失敗。' });
    }
  });

  router.post('/publish/facebook', async (request, response) => {
    const postId = request.body?.postId;
    const targetId = request.body?.targetId;
    const source = String(request.body?.source || 'manual');
    const idempotencyKey = String(request.get('Idempotency-Key') || request.body?.idempotencyKey || '').trim();
    try {
      const result = await publishTarget({
        postId,
        targetId,
        expectedPlatformId: 'facebook',
        source,
        idempotencyKey,
        fallbackPublisher: facebookPublisher,
        resolveFacebookPublisher,
        resolveInstagramPublisher,
        resolveThreadsPublisher,
      });
      response.json(result);
    } catch (error) {
      await markTargetPublishFailure(postId, targetId, error).catch(() => {});
      if (error.status === 404 || error.status === 400 || error.status === 409 || error.status === 503) {
        return response.status(error.status).json({ error: error.message });
      }
      const status = error instanceof FacebookPublishError ? 502 : 500;
      response.status(status).json({ error: error.message || 'Facebook 發布失敗。' });
    }
  });

  return router;
}
