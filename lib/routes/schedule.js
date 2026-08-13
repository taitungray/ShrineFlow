import { Router } from 'express';
import { readJson, mutateJson, jsonFiles } from '../store.js';
import { getContentType } from '../platforms.js';
import { findAccount, listClientsRaw } from '../clients.js';
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

export function createScheduleRouter({ publishingPlatforms }) {
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

    const clients = await listClientsRaw();
    const updated = await mutateJson(jsonFiles.posts, (posts) => {
      const post = posts.find((item) => item.id === postId);
      if (!post) return { error: '找不到要排程的貼文。', status: 404 };

      const normalized = migrateLegacyPost(post, post.clientId || clients[0]?.id || '');
      Object.assign(post, normalized);

      const client = clients.find((item) => item.id === post.clientId) || null;
      let target = targetId
        ? (post.targets || []).find((item) => item.id === targetId)
        : (post.targets || []).find((item) => (
          item.accountId === accountId
          && item.platformId === channel
          && item.contentType === contentType
        ));

      if (!target) {
        const resolvedAccountId = accountId
          || (channel === 'facebook'
            ? findAccount(client, `facebook:${process.env.FACEBOOK_PAGE_ID || ''}`)?.id
            : '')
          || `${channel}:default`;
        target = normalizeTarget({
          accountId: resolvedAccountId,
          platformId: channel,
          contentType,
          contentSettings,
        });
        post.targets.push(target);
      }

      const account = findAccount(client, target.accountId);
      if (channel === 'facebook') {
        if (!selectedContentType.canPublish) {
          return { error: `${platform.name} 的「${selectedContentType.name}」尚未串接發布功能。`, status: 400 };
        }
        if (!account?.configured) {
          return { error: '請先在此客戶下完成 Facebook 帳號設定。', status: 400 };
        }
      }

      const mediaPaths = resolveTargetMedia(post, target);
      const scheduledVideos = mediaPaths.filter((mediaPath) => /\.(avi|m4v|mov|mp4|mpeg|mpg|ogv|webm)$/i.test(mediaPath));
      if (channel === 'facebook' && scheduledVideos.length && mediaPaths.length !== 1) {
        return { error: 'Facebook 排程支援多張圖片或單一影片，暫不支援圖片與影片混合發布。', status: 400 };
      }

      if (['scheduled', 'pending', 'retrying', 'publishing'].includes(target.status) && target.scheduledAt) {
        // allow reschedule
      }

      target.scheduledAt = new Date(scheduledAt).toISOString();
      target.status = 'scheduled';
      target.contentType = contentType;
      target.contentSettings = contentSettings && typeof contentSettings === 'object' ? contentSettings : {};
      target.lastError = null;
      delete target.nextAttemptAt;
      post.status = summarizePostStatus(post.targets);

      return {
        status: 201,
        item: {
          id: target.id,
          postId: post.id,
          targetId: target.id,
          clientId: post.clientId,
          channel: target.platformId,
          accountId: target.accountId,
          contentType: target.contentType,
          contentSettings: target.contentSettings,
          scheduledAt: target.scheduledAt,
          status: target.status,
        },
      };
    });

    if (updated?.error) {
      return response.status(updated.status || 400).json({ error: updated.error });
    }
    response.status(201).json(updated.item);
  });

  return router;
}
