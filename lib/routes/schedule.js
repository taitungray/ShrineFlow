import { Router } from 'express';
import path from 'node:path';
import { readJson, mutateJson, jsonFiles } from '../store.js';
import { directories } from '../store.js';
import { getContentType } from '../platforms.js';
import { findAccount, listClientsRaw } from '../clients.js';
import {
  rejectLocalScheduleTooSoon,
  rejectScheduleContentType,
} from '../schedule-policy.js';
import {
  cancelFacebookTarget,
  rescheduleFacebookTarget,
  scheduleFacebookTarget,
} from '../native-schedule.js';
import {
  migrateLegacyPost,
  normalizeTarget,
  resolveTargetMedia,
  summarizePostStatus,
} from '../post-targets.js';

function flattenScheduleRows(posts = [], clients = [], clientId = '') {
  const clientNameById = new Map(clients.map((client) => [client.id, client.name]));
  const rows = [];
  for (const post of posts) {
    if (clientId && post.clientId !== clientId) continue;
    const targets = Array.isArray(post.targets) ? post.targets : [];
    for (const target of targets) {
      if (!target.scheduledAt && !['scheduled', 'pending', 'retrying', 'publishing', 'published', 'failed', 'skipped_unsupported'].includes(target.status)) {
        continue;
      }
      if (!target.scheduledAt && target.status === 'draft') continue;
      rows.push({
        id: target.id,
        postId: post.id,
        targetId: target.id,
        clientId: post.clientId,
        clientName: clientNameById.get(post.clientId) || '',
        godName: post.godName,
        channel: target.platformId,
        accountId: target.accountId,
        contentType: target.contentType,
        contentSettings: target.contentSettings || {},
        scheduledAt: target.scheduledAt,
        status: target.status,
        publishedAt: target.publishedAt || null,
        externalId: target.externalId || null,
        lastError: target.lastError || null,
        createdAt: post.createdAt,
      });
    }
  }
  return rows.sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0));
}

function mediaFilePathsFromWebPaths(mediaPaths = []) {
  return mediaPaths
    .filter((mediaPath) => String(mediaPath).startsWith('/uploads/'))
    .map((mediaPath) => path.join(directories.uploads, path.basename(String(mediaPath))));
}

export function createScheduleRouter({ publishingPlatforms, resolveFacebookPublisher }) {
  const router = Router();

  router.get('/schedule', async (request, response) => {
    const clientId = String(request.query.clientId || '').trim();
    const [postsRaw, clients] = await Promise.all([
      readJson(jsonFiles.posts, []),
      listClientsRaw(),
    ]);
    const posts = postsRaw.map((post) => migrateLegacyPost(post, post.clientId || clients[0]?.id || ''));
    response.json(flattenScheduleRows(posts, clients, clientId));
  });

  router.post('/schedule', async (request, response) => {
    const {
      postId,
      targetId = '',
      scheduledAt,
      channel = 'facebook',
      accountId = '',
      contentType = 'post',
      contentSettings = {},
    } = request.body || {};

    if (!postId || !scheduledAt) {
      return response.status(400).json({ error: '請選擇貼文與排程時間。' });
    }
    if (Number.isNaN(new Date(scheduledAt).getTime())) {
      return response.status(400).json({ error: '排程時間格式不正確。' });
    }

    const platform = publishingPlatforms.find((item) => item.id === channel);
    if (!platform) return response.status(400).json({ error: '不支援的發布平台。' });

    const selectedContentType = getContentType(channel, contentType);
    if (!selectedContentType || selectedContentType.id !== contentType) {
      return response.status(400).json({ error: '不支援的發布格式。' });
    }
    const policyError = rejectScheduleContentType(channel, contentType);
    if (policyError) return response.status(400).json({ error: policyError });
    if (channel !== 'facebook') {
      const localScheduleError = rejectLocalScheduleTooSoon(scheduledAt);
      if (localScheduleError) return response.status(400).json({ error: localScheduleError });
    }

    const clients = await listClientsRaw();
    const posts = await readJson(jsonFiles.posts, []);
    const post = posts.find((item) => item.id === postId);
    if (!post) return response.status(404).json({ error: '找不到要排程的貼文。' });

    const normalized = migrateLegacyPost(post, post.clientId || clients[0]?.id || '');
    const client = clients.find((item) => item.id === normalized.clientId) || null;
    let target = targetId
      ? normalized.targets.find((item) => item.id === targetId)
      : normalized.targets.find((item) => (
        item.accountId === accountId && item.platformId === channel && item.contentType === contentType
      ));
    if (targetId && target) {
      const accountMismatch = accountId && target.accountId !== accountId;
      const platformMismatch = target.platformId !== channel;
      const contentTypeMismatch = target.contentType !== contentType;
      if (platformMismatch || contentTypeMismatch || accountMismatch) {
        return response.status(400).json({ error: '排程目標與指定平台／格式不符。' });
      }
    }
    if (!target && !targetId && !post.targets?.length && normalized.targets.length === 1) {
      target = normalized.targets[0];
      if (accountId) target.accountId = accountId;
    }
    if (!target) {
      const resolvedAccountId = accountId
        || (channel === 'facebook'
          ? findAccount(client, `facebook:${process.env.FACEBOOK_PAGE_ID || ''}`)?.id
          : '')
        || `${channel}:default`;
      target = normalizeTarget({ accountId: resolvedAccountId, platformId: channel, contentType, contentSettings });
    }

    if (channel === 'facebook' && !selectedContentType.canPublish) {
      return response.status(400).json({ error: `${platform.name} 的「${selectedContentType.name}」尚未串接發布功能。` });
    }

    const mediaPaths = resolveTargetMedia(normalized, target);
    const scheduledVideos = mediaPaths.filter((mediaPath) => /\.(avi|m4v|mov|mp4|mpeg|mpg|ogv|webm)$/i.test(mediaPath));
    if (channel === 'facebook' && scheduledVideos.length && mediaPaths.length !== 1) {
      return response.status(400).json({ error: 'Facebook 排程支援多張圖片或單一影片，暫不支援圖片與影片混合發布。' });
    }

    let result = {
      scheduledAt: new Date(scheduledAt).toISOString(),
      status: 'scheduled',
      externalId: null,
      lastError: null,
    };
    if (channel === 'facebook') {
      try {
        const publisher = await resolveFacebookPublisher?.({
          clientId: normalized.clientId,
          accountId: target.accountId,
        });
        const scheduleArgs = {
          publisher,
          post: normalized,
          target: { ...target, contentType, contentSettings },
          scheduledAt,
          mediaFilePaths: mediaFilePathsFromWebPaths(mediaPaths),
        };
        result = target.externalId
          ? await rescheduleFacebookTarget(scheduleArgs)
          : await scheduleFacebookTarget(scheduleArgs);
      } catch (error) {
        return response.status(400).json({ error: error.message || 'Facebook 排程失敗。' });
      }
    }

    const updated = await mutateJson(jsonFiles.posts, (storedPosts) => {
      const storedPost = storedPosts.find((item) => item.id === postId);
      if (!storedPost) return { error: '找不到要排程的貼文。', status: 404 };
      const storedNormalized = migrateLegacyPost(storedPost, storedPost.clientId || normalized.clientId);
      let storedTarget = storedNormalized.targets.find((item) => item.id === target.id);
      if (!storedTarget && !storedPost.targets?.length && storedNormalized.targets.length === 1) {
        storedTarget = storedNormalized.targets[0];
        storedTarget.accountId = target.accountId;
      }
      if (!storedTarget) {
        storedTarget = normalizeTarget(target);
        storedNormalized.targets.push(storedTarget);
      }
      Object.assign(storedTarget, {
        scheduledAt: result.scheduledAt,
        status: 'scheduled',
        contentType,
        contentSettings: contentSettings && typeof contentSettings === 'object' ? contentSettings : {},
        externalId: result.externalId,
        lastError: null,
      });
      delete storedTarget.nextAttemptAt;
      storedNormalized.status = summarizePostStatus(storedNormalized.targets);
      Object.assign(storedPost, storedNormalized);
      return {
        status: 201,
        item: {
          id: storedTarget.id, postId: storedPost.id, targetId: storedTarget.id,
          clientId: storedPost.clientId, channel: storedTarget.platformId,
          accountId: storedTarget.accountId, contentType: storedTarget.contentType,
          contentSettings: storedTarget.contentSettings, scheduledAt: storedTarget.scheduledAt,
          status: storedTarget.status, externalId: storedTarget.externalId || null,
        },
      };
    });

    if (updated?.error) {
      return response.status(updated.status || 400).json({ error: updated.error });
    }
    response.status(201).json(updated.item);
  });

  router.patch('/schedule/:targetId', async (request, response) => {
    const targetId = String(request.params.targetId || '').trim();
    const { scheduledAt } = request.body || {};
    if (!targetId || !scheduledAt) {
      return response.status(400).json({ error: '請提供排程目標與排程時間。' });
    }
    if (Number.isNaN(new Date(scheduledAt).getTime())) {
      return response.status(400).json({ error: '排程時間格式不正確。' });
    }

    const [posts, clients] = await Promise.all([
      readJson(jsonFiles.posts, []),
      listClientsRaw(),
    ]);
    const post = posts.find((item) => (item.targets || []).some((target) => target.id === targetId));
    if (!post) return response.status(404).json({ error: '找不到排程目標。' });
    const normalized = migrateLegacyPost(post, post.clientId || clients[0]?.id || '');
    const target = normalized.targets.find((item) => item.id === targetId);
    if (!target) return response.status(404).json({ error: '找不到排程目標。' });
    let result = {
      scheduledAt: new Date(scheduledAt).toISOString(),
      status: 'scheduled',
      externalId: null,
      lastError: null,
    };
    if (target.platformId === 'facebook') {
      const policyError = rejectScheduleContentType('facebook', target.contentType);
      if (policyError) return response.status(400).json({ error: policyError });

      const mediaPaths = resolveTargetMedia(normalized, target);
      const scheduledVideos = mediaPaths.filter((mediaPath) => /\.(avi|m4v|mov|mp4|mpeg|mpg|ogv|webm)$/i.test(mediaPath));
      if (scheduledVideos.length && mediaPaths.length !== 1) {
        return response.status(400).json({ error: 'Facebook 排程支援多張圖片或單一影片，暫不支援圖片與影片混合發布。' });
      }

      try {
        const publisher = await resolveFacebookPublisher?.({
          clientId: normalized.clientId,
          accountId: target.accountId,
        });
        result = await rescheduleFacebookTarget({
          publisher,
          post: normalized,
          target,
          scheduledAt,
          mediaFilePaths: mediaFilePathsFromWebPaths(mediaPaths),
        });
      } catch (error) {
        if (error.remoteDeleted) {
          await mutateJson(jsonFiles.posts, (storedPosts) => {
            const storedPost = storedPosts.find((item) => item.id === post.id);
            const storedTarget = storedPost?.targets?.find((item) => item.id === targetId);
            if (!storedPost || !storedTarget) return;
            storedTarget.status = 'failed';
            storedTarget.scheduledAt = null;
            storedTarget.externalId = null;
            storedTarget.lastError = {
              message: error.message || 'Facebook 排程失敗。',
              code: error.code,
              subcode: error.subcode,
              traceId: error.traceId,
              at: new Date().toISOString(),
            };
            storedPost.status = summarizePostStatus(storedPost.targets);
          });
        }
        return response.status(error.remoteDeleted ? 502 : 400).json({
          error: error.message || 'Facebook 排程失敗。',
        });
      }
    } else {
      const localScheduleError = rejectLocalScheduleTooSoon(scheduledAt);
      if (localScheduleError) return response.status(400).json({ error: localScheduleError });
    }

    const updated = await mutateJson(jsonFiles.posts, (storedPosts) => {
      const storedPost = storedPosts.find((item) => item.id === post.id);
      const storedTarget = storedPost?.targets?.find((item) => item.id === targetId);
      if (!storedPost || !storedTarget) return { error: '找不到排程目標。', status: 404 };
      Object.assign(storedTarget, result);
      storedPost.status = summarizePostStatus(storedPost.targets);
      return { status: 200, item: { ...storedTarget, postId: storedPost.id, targetId: storedTarget.id } };
    });
    if (updated?.error) return response.status(updated.status || 400).json({ error: updated.error });
    return response.json(updated.item);
  });

  router.delete('/schedule/:targetId', async (request, response) => {
    const targetId = String(request.params.targetId || '').trim();
    if (!targetId) return response.status(400).json({ error: '請提供排程目標。' });

    const [posts, clients] = await Promise.all([
      readJson(jsonFiles.posts, []),
      listClientsRaw(),
    ]);
    const post = posts.find((item) => (item.targets || []).some((target) => target.id === targetId));
    if (!post) return response.status(404).json({ error: '找不到排程目標。' });
    const normalized = migrateLegacyPost(post, post.clientId || clients[0]?.id || '');
    const target = normalized.targets.find((item) => item.id === targetId);
    if (!target) return response.status(404).json({ error: '找不到排程目標。' });
    if (target.platformId === 'facebook') {
      try {
        const publisher = await resolveFacebookPublisher?.({
          clientId: normalized.clientId,
          accountId: target.accountId,
        });
        await cancelFacebookTarget({ publisher, target });
      } catch (error) {
        return response.status(502).json({ error: error.message || 'Facebook 取消排程失敗。' });
      }
    }

    const updated = await mutateJson(jsonFiles.posts, (storedPosts) => {
      const storedPost = storedPosts.find((item) => item.id === post.id);
      const storedTarget = storedPost?.targets?.find((item) => item.id === targetId);
      if (!storedPost || !storedTarget) return { error: '找不到排程目標。', status: 404 };
      Object.assign(storedTarget, {
        status: 'draft',
        scheduledAt: null,
        externalId: null,
        lastError: null,
      });
      storedPost.status = summarizePostStatus(storedPost.targets);
      return { status: 200, item: { ...storedTarget, postId: storedPost.id, targetId: storedTarget.id } };
    });
    if (updated?.error) return response.status(updated.status || 400).json({ error: updated.error });
    return response.json(updated.item);
  });

  return router;
}
