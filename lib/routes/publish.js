import { Router } from 'express';
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
import path from 'node:path';
import { directories } from '../store.js';

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
  const error = new Error(`${names[platformId] || platformId} 尚未設定。請先填入發布帳號憑證。`);
  error.status = 503;
  return error;
}

function isPublicMediaConfigurationError(error) {
  return (
    error instanceof InstagramPublishError
    || error instanceof ThreadsPublishError
  ) && /PUBLIC_MEDIA_BASE_URL|公開網址/i.test(String(error.message || ''));
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

  const post = migrateLegacyPost(postRaw, postRaw.clientId || '');
  let target = (post.targets || []).find((item) => item.id === targetId);
  if (!target && post.targets?.length === 1) target = post.targets[0];
  if (!target) {
    target = (post.targets || []).find(
      (item) => item.platformId === (expectedPlatformId || 'facebook'),
    ) || null;
  }
  if (!target || (expectedPlatformId && target.platformId !== expectedPlatformId)) {
    const platformName = expectedPlatformId === 'facebook' ? ' Facebook' : '';
    const error = new Error(`找不到可發布的${platformName}目標。`);
    error.status = 400;
    throw error;
  }

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
  const result = await publisher.publish(publishPost, publishOptions);

  const publishedAt = new Date().toISOString();
  await mutateJson(jsonFiles.posts, (records) => {
    const current = records.find((item) => item.id === post.id);
    if (!current) return;
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
    }
    current.status = summarizePostStatus(current.targets);
    current.publishedAt = publishedAt;
    if (target.platformId === 'facebook') {
      current.facebookPostId = result.externalId;
    }
  });

  return { ...result, publishedAt, targetId: target.id };
}

export function createPublishRouter({
  facebookPublisher,
  resolveFacebookPublisher,
  resolveInstagramPublisher,
  resolveThreadsPublisher,
} = {}) {
  const router = Router();

  router.post('/publish/target', async (request, response) => {
    try {
      const result = await publishTarget({
        postId: request.body?.postId,
        targetId: request.body?.targetId,
        fallbackPublisher: facebookPublisher,
        resolveFacebookPublisher,
        resolveInstagramPublisher,
        resolveThreadsPublisher,
      });
      response.json(result);
    } catch (error) {
      if (error.status === 404 || error.status === 400 || error.status === 503) {
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
    try {
      const result = await publishTarget({
        postId: request.body?.postId,
        targetId: request.body?.targetId,
        expectedPlatformId: 'facebook',
        fallbackPublisher: facebookPublisher,
        resolveFacebookPublisher,
        resolveInstagramPublisher,
        resolveThreadsPublisher,
      });
      response.json(result);
    } catch (error) {
      if (error.status === 404 || error.status === 400 || error.status === 503) {
        return response.status(error.status).json({ error: error.message });
      }
      const status = error instanceof FacebookPublishError ? 502 : 500;
      response.status(status).json({ error: error.message || 'Facebook 發布失敗。' });
    }
  });

  return router;
}
