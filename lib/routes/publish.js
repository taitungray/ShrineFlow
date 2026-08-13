import { Router } from 'express';
import { readJson, mutateJson, jsonFiles } from '../store.js';
import { resolvePostMediaPaths } from '../upload.js';
import { normalizePostCopy } from '../copy-format.js';
import { createFacebookPublisher, FacebookPublishError } from '../facebook.js';
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

async function publishFacebookTarget({ postId, targetId, fallbackPublisher }) {
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
    target = (post.targets || []).find((item) => item.platformId === 'facebook') || null;
  }
  if (!target || target.platformId !== 'facebook') {
    const error = new Error('找不到可發布的 Facebook 目標。');
    error.status = 400;
    throw error;
  }

  const client = await getClientRaw(post.clientId);
  const account = findAccount(client, target.accountId);
  const publisher = (account?.credentials?.pageId && account?.credentials?.pageAccessToken)
    ? createFacebookPublisher({
      pageId: account.credentials.pageId,
      pageAccessToken: account.credentials.pageAccessToken,
      graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
      graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
    })
    : fallbackPublisher;

  if (!publisher?.configured) {
    const error = new Error('Facebook 尚未設定。請在客戶帳號或 .env 填入粉專憑證。');
    error.status = 503;
    throw error;
  }

  const copy = resolveTargetCopy(post, target);
  const publishPost = normalizePostCopy({
    ...post,
    facebook: target.contentType === 'reel' ? post.facebook : copy,
    reel: target.contentType === 'reel' ? copy : post.reel,
  });
  const mediaPaths = resolveTargetMedia(post, target);
  const result = await publisher.publish(publishPost, {
    mediaFilePaths: mediaPaths.length
      ? mediaFilePathsFromWebPaths(mediaPaths)
      : resolvePostMediaPaths(post),
  });

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
    current.facebookPostId = result.externalId;
  });

  return { ...result, publishedAt, targetId: target.id };
}

export function createPublishRouter({ facebookPublisher }) {
  const router = Router();

  router.post('/publish/target', async (request, response) => {
    try {
      const result = await publishFacebookTarget({
        postId: request.body?.postId,
        targetId: request.body?.targetId,
        fallbackPublisher: facebookPublisher,
      });
      response.json(result);
    } catch (error) {
      if (error.status === 404 || error.status === 400 || error.status === 503) {
        return response.status(error.status).json({ error: error.message });
      }
      const status = error instanceof FacebookPublishError && error.status ? 502 : 500;
      response.status(status).json({ error: error.message || '發布失敗。' });
    }
  });

  router.post('/publish/facebook', async (request, response) => {
    try {
      const result = await publishFacebookTarget({
        postId: request.body?.postId,
        targetId: request.body?.targetId,
        fallbackPublisher: facebookPublisher,
      });
      response.json(result);
    } catch (error) {
      if (error.status === 404 || error.status === 400 || error.status === 503) {
        return response.status(error.status).json({ error: error.message });
      }
      const status = error instanceof FacebookPublishError && error.status ? 502 : 500;
      response.status(status).json({ error: error.message || 'Facebook 發布失敗。' });
    }
  });

  return router;
}
