import { Router } from 'express';

import { getRepositories } from '../repositories.js';
import { listClientsRaw } from '../clients.js';
import { canAccessClient, requestedOrAccessibleClientId } from '../request-scope.js';
import { appendPostVersion } from '../post-history.js';
import { bumpPostVersion } from '../post-version.js';
import { addPostLifecycleEvent, isPostArchived, isPostIdea } from '../post-lifecycle.js';
import { migrateLegacyPost } from '../post-targets.js';
import { rejectLocalScheduleTooSoon } from '../schedule-policy.js';
import {
  normalizeEvergreenConfig,
  scheduleNextEvergreenOccurrence,
  validateEvergreenSettings,
} from '../evergreen.js';

function errorResponse(response, status, error, code, details = {}) {
  return response.status(status).json({ error, code, ...details });
}

export function createEvergreenRouter({ repositories = getRepositories(), listClients = listClientsRaw } = {}) {
  const router = Router();

  async function loadPost(request, postId, clientId = '') {
    const posts = await repositories.posts.list();
    const post = posts.find((entry) => entry.id === postId);
    if (!post) return { error: { status: 404, message: '找不到貼文。', code: 'POST_NOT_FOUND' } };
    const resolvedClientId = clientId || post.clientId || '';
    if (!canAccessClient(request, resolvedClientId)) return { error: { status: 403, message: '無法存取此品牌。', code: 'CLIENT_FORBIDDEN' } };
    return { post, clientId: resolvedClientId };
  }

  router.get('/posts/:postId/evergreen', async (request, response) => {
    try {
      const loaded = await loadPost(request, request.params.postId, String(request.query.clientId || '').trim());
      if (loaded.error) return errorResponse(response, loaded.error.status, loaded.error.message, loaded.error.code);
      response.json({
        postId: loaded.post.id,
        clientId: loaded.clientId,
        evergreen: normalizeEvergreenConfig(loaded.post.evergreen),
        source: loaded.post.evergreenSource || null,
      });
    } catch (error) {
      errorResponse(response, error.status || 500, error.message || 'Evergreen 讀取失敗。', error.code || 'EVERGREEN_READ_FAILED');
    }
  });

  router.post('/posts/:postId/evergreen', async (request, response) => {
    try {
      const body = request.body || {};
      const loaded = await loadPost(request, request.params.postId, requestedOrAccessibleClientId(request, body.clientId, ''));
      if (loaded.error) return errorResponse(response, loaded.error.status, loaded.error.message, loaded.error.code);
      const clients = await listClients(repositories);
      const client = clients.find((entry) => entry.id === loaded.clientId);
      if (!client) return errorResponse(response, 404, '找不到品牌。', 'CLIENT_NOT_FOUND');
      if (client.approvalRequired) return errorResponse(response, 409, '此品牌已啟用審核，Evergreen 不會繞過核准流程。', 'EVERGREEN_APPROVAL_REQUIRED');
      const post = migrateLegacyPost(loaded.post, loaded.clientId);
      if (isPostIdea(post)) return errorResponse(response, 409, 'Idea 尚未轉成草稿，不能啟用 Evergreen。', 'IDEA_NOT_READY');
      if (isPostArchived(post)) return errorResponse(response, 409, '封存中的貼文不能啟用 Evergreen。', 'POST_ARCHIVED');
      const sourceTarget = post.targets.find((target) => target.status === 'published');
      if (!sourceTarget) return errorResponse(response, 409, 'Evergreen 必須從已發布的 target 開始。', 'EVERGREEN_SOURCE_NOT_PUBLISHED');
      const settings = validateEvergreenSettings(body);
      if (!settings.ok) return errorResponse(response, 400, settings.message, settings.code);
      const now = new Date();
      const defaultStart = new Date(sourceTarget.publishedAt || now);
      defaultStart.setUTCDate(defaultStart.getUTCDate() + settings.intervalDays);
      const nextScheduledAt = body.startAt ? new Date(body.startAt) : defaultStart;
      if (Number.isNaN(nextScheduledAt.getTime())) return errorResponse(response, 400, 'Evergreen 起始時間格式不正確。', 'EVERGREEN_START_INVALID');
      const tooSoon = rejectLocalScheduleTooSoon(nextScheduledAt, now);
      if (tooSoon) return errorResponse(response, 400, tooSoon, 'EVERGREEN_START_TOO_SOON');
      const updated = await repositories.posts.mutate((records) => {
        const stored = records.find((entry) => entry.id === loaded.post.id);
        if (!stored) return { error: '找不到貼文。', status: 404 };
        const normalized = migrateLegacyPost(stored, loaded.clientId);
        const published = normalized.targets.find((target) => target.id === sourceTarget.id && target.status === 'published');
        if (!published) return { error: '來源 target 在設定期間已變更。', status: 409, code: 'EVERGREEN_SOURCE_CONFLICT' };
        const timestamp = now.toISOString();
        Object.assign(stored, normalized, {
          evergreen: {
            ...normalizeEvergreenConfig(stored.evergreen),
            enabled: true,
            paused: false,
            intervalDays: settings.intervalDays,
            maxOccurrences: settings.maxOccurrences,
            occurrenceCount: 0,
            nextScheduledAt: nextScheduledAt.toISOString(),
            lastOccurrenceAt: null,
            lastError: null,
            updatedAt: timestamp,
          },
          updatedAt: timestamp,
        });
        bumpPostVersion(stored);
        addPostLifecycleEvent(stored, 'evergreen_enabled', {
          intervalDays: settings.intervalDays,
          maxOccurrences: settings.maxOccurrences,
          nextScheduledAt: nextScheduledAt.toISOString(),
        }, timestamp);
        return { post: stored };
      });
      if (updated?.error) return errorResponse(response, updated.status || 409, updated.error, updated.code || 'EVERGREEN_ENABLE_FAILED');
      const scheduled = await scheduleNextEvergreenOccurrence({
        sourcePostId: updated.post.id,
        sourceTargetId: sourceTarget.id,
        nextAt: nextScheduledAt,
        now,
        repositories,
      });
      await appendPostVersion({ post: updated.post, source: 'evergreen_enable' });
      response.status(201).json({
        postId: updated.post.id,
        clientId: loaded.clientId,
        evergreen: scheduled.root?.evergreen || updated.post.evergreen,
        occurrence: scheduled.occurrence || null,
        scheduleStatus: scheduled.status,
        scheduleMode: 'local',
        remoteScheduling: false,
      });
    } catch (error) {
      errorResponse(response, error.status || 500, error.message || 'Evergreen 啟用失敗。', error.code || 'EVERGREEN_ENABLE_FAILED');
    }
  });

  router.patch('/posts/:postId/evergreen', async (request, response) => {
    try {
      const body = request.body || {};
      const loaded = await loadPost(request, request.params.postId, requestedOrAccessibleClientId(request, body.clientId, ''));
      if (loaded.error) return errorResponse(response, loaded.error.status, loaded.error.message, loaded.error.code);
      if (typeof body.paused !== 'boolean' && typeof body.enabled !== 'boolean') return errorResponse(response, 400, '請提供 paused 或 enabled。', 'EVERGREEN_PATCH_REQUIRED');
      const now = new Date().toISOString();
      const updated = await repositories.posts.mutate((records) => {
        const stored = records.find((entry) => entry.id === loaded.post.id);
        if (!stored) return { error: '找不到貼文。', status: 404 };
        const config = normalizeEvergreenConfig(stored.evergreen);
        if (!config.enabled && body.enabled !== true) return { error: '此貼文尚未啟用 Evergreen。', status: 409, code: 'EVERGREEN_NOT_ENABLED' };
        const next = {
          ...config,
          ...(typeof body.paused === 'boolean' ? { paused: body.paused } : {}),
          ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
          updatedAt: now,
          lastError: null,
        };
        Object.assign(stored, { evergreen: next, updatedAt: now });
        bumpPostVersion(stored);
        addPostLifecycleEvent(stored, next.paused ? 'evergreen_paused' : 'evergreen_resumed', {}, now);
        return { post: stored, evergreen: next };
      });
      if (updated?.error) return errorResponse(response, updated.status || 409, updated.error, updated.code || 'EVERGREEN_PATCH_FAILED');
      await appendPostVersion({ post: updated.post, source: 'evergreen_settings' });
      response.json({ postId: updated.post.id, evergreen: updated.evergreen });
    } catch (error) {
      errorResponse(response, error.status || 500, error.message || 'Evergreen 更新失敗。', error.code || 'EVERGREEN_PATCH_FAILED');
    }
  });

  router.delete('/posts/:postId/evergreen', async (request, response) => {
    try {
      const loaded = await loadPost(request, request.params.postId, String(request.query.clientId || '').trim());
      if (loaded.error) return errorResponse(response, loaded.error.status, loaded.error.message, loaded.error.code);
      const now = new Date().toISOString();
      const updated = await repositories.posts.mutate((records) => {
        const stored = records.find((entry) => entry.id === loaded.post.id);
        if (!stored) return { error: '找不到貼文。', status: 404 };
        const config = normalizeEvergreenConfig(stored.evergreen);
        Object.assign(stored, {
          evergreen: { ...config, enabled: false, paused: true, updatedAt: now },
          updatedAt: now,
        });
        bumpPostVersion(stored);
        addPostLifecycleEvent(stored, 'evergreen_disabled', {}, now);
        return { post: stored };
      });
      if (updated?.error) return errorResponse(response, updated.status || 409, updated.error, updated.code || 'EVERGREEN_DISABLE_FAILED');
      await appendPostVersion({ post: updated.post, source: 'evergreen_settings' });
      response.json({ postId: updated.post.id, evergreen: updated.post.evergreen, pendingOccurrencesRemain: true });
    } catch (error) {
      errorResponse(response, error.status || 500, error.message || 'Evergreen 停用失敗。', error.code || 'EVERGREEN_DISABLE_FAILED');
    }
  });

  return router;
}
