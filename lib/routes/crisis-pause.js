import { Router } from 'express';
import { bumpPostVersion } from '../post-version.js';
import { getMediaStorage } from '../media-storage.js';
import { getRepositories } from '../repositories.js';
import {
  findAccount,
  getClientRaw,
  updateClientCrisisPause,
} from '../clients.js';
import { cancelFacebookTarget, scheduleFacebookTarget } from '../native-schedule.js';
import { appendPostVersion } from '../post-history.js';
import { migrateLegacyPost, normalizeTarget, resolveTargetMedia } from '../post-targets.js';

const ACTIVE_SCHEDULE_STATUSES = new Set(['scheduled', 'pending', 'retrying', 'publishing']);
const PAUSE_SCOPES = new Set(['client', 'account', 'platform']);

function safeError(error, code = '') {
  return {
    message: error?.message || '危機暫停操作失敗。',
    code: error?.code || code || 'CRISIS_PAUSE_FAILED',
    status: error?.status || null,
  };
}

function scopeFromBody(client, body = {}) {
  const scope = String(body.scope || 'client').trim().toLowerCase();
  if (!PAUSE_SCOPES.has(scope)) {
    const error = new Error('暫停範圍只能是品牌、帳號或平台。');
    error.status = 400;
    error.code = 'CRISIS_PAUSE_SCOPE_INVALID';
    throw error;
  }
  const accountId = String(body.accountId || '').trim();
  const platformId = String(body.platformId || '').trim();
  if (scope === 'account' && !findAccount(client, accountId)) {
    const error = new Error('找不到暫停範圍的平台連線。');
    error.status = 404;
    error.code = 'CRISIS_PAUSE_ACCOUNT_NOT_FOUND';
    throw error;
  }
  if (scope === 'platform' && !['facebook', 'instagram', 'threads'].includes(platformId)) {
    const error = new Error('找不到暫停範圍的平台。');
    error.status = 400;
    error.code = 'CRISIS_PAUSE_PLATFORM_INVALID';
    throw error;
  }
  return {
    scope,
    accountId: scope === 'account' ? accountId : null,
    platformId: scope === 'platform' ? platformId : null,
    key: scope === 'client' ? 'client' : `${scope}:${scope === 'account' ? accountId : platformId}`,
  };
}

function targetMatchesScope(target, scope) {
  if (scope.scope === 'client') return true;
  if (scope.scope === 'account') return target.accountId === scope.accountId;
  return target.platformId === scope.platformId;
}

function isManagedScheduleTarget(target) {
  if (!ACTIVE_SCHEDULE_STATUSES.has(target.status) || !target.scheduledAt) return false;
  if (target.platformId === 'facebook') {
    return Boolean(target.externalId) || target.scheduleSource === 'facebook_native';
  }
  return target.scheduleSource === 'local' || !target.scheduleSource;
}

async function mediaFilePathsFromWebPaths(mediaPaths = []) {
  return mediaPaths
    .filter((mediaPath) => String(mediaPath).startsWith('/uploads/'))
    .map((mediaPath) => getMediaStorage().resolveFilePath(mediaPath))
    .filter(Boolean);
}

async function mediaBuffersFromWebPaths(mediaPaths = []) {
  const storage = getMediaStorage();
  if (storage.backend !== 'r2') return [];
  return Promise.all(mediaPaths.map(async (mediaPath) => ({
    path: mediaPath,
    name: String(mediaPath).split('/').pop() || 'media',
    buffer: await storage.getBuffer(mediaPath),
  })));
}

async function appendVersions(posts = []) {
  await Promise.all(posts.filter(Boolean).map((post) => appendPostVersion({
    post,
    source: 'crisis_pause',
  })));
}

async function targetEntries(repositories, clientId, scope) {
  const posts = await repositories.posts.list();
  return posts
    .filter((post) => post.clientId === clientId)
    .flatMap((post) => {
      const normalized = migrateLegacyPost(post, clientId);
      return (normalized.targets || []).map((target) => ({ postId: post.id, target }));
    })
    .filter(({ target }) => targetMatchesScope(target, scope) && isManagedScheduleTarget(target));
}

function resultFor(entry, status, extra = {}) {
  return {
    postId: entry.postId,
    targetId: entry.target.id,
    platformId: entry.target.platformId,
    status,
    ...extra,
  };
}

export function createCrisisPauseRouter({
  resolveFacebookPublisher,
  repositories = getRepositories(),
  getClient = getClientRaw,
} = {}) {
  const router = Router();

  router.get('/crisis-pause', async (request, response) => {
    const clientId = String(request.query.clientId || request.authorizedClientId || '').trim();
    const client = await getClient(clientId);
    if (!client) return response.status(404).json({ error: '找不到品牌。' });
    response.json({
      clientId: client.id,
      status: client.crisisPause?.status === 'paused' ? 'paused' : 'active',
      pause: client.crisisPause || null,
    });
  });

  router.post('/crisis-pause', async (request, response) => {
    const clientId = String(request.body?.clientId || request.authorizedClientId || '').trim();
    const client = await getClient(clientId);
    if (!client) return response.status(404).json({ error: '找不到品牌。' });
    try {
      const scope = scopeFromBody(client, request.body || {});
      const reason = String(request.body?.reason || '').trim().slice(0, 500) || '危機暫停';
      const pausedAt = new Date().toISOString();
      const entries = await targetEntries(repositories, client.id, scope);
      const outcomes = new Map();
      for (const entry of entries) {
        if (entry.target.platformId !== 'facebook' || !entry.target.externalId) {
          outcomes.set(entry.target.id, { remoteCancel: 'not_required' });
          continue;
        }
        try {
          const publisher = await resolveFacebookPublisher?.({
            clientId: client.id,
            accountId: entry.target.accountId,
          });
          await cancelFacebookTarget({ publisher, target: entry.target });
          outcomes.set(entry.target.id, { remoteCancel: 'cancelled' });
        } catch (error) {
          outcomes.set(entry.target.id, { remoteCancel: 'failed', error: safeError(error, 'REMOTE_CANCEL_FAILED') });
        }
      }

      const updated = await repositories.posts.mutate((posts) => {
        const changedPosts = [];
        for (const post of posts) {
          if (post.clientId !== client.id) continue;
          const storedTargetIds = new Set(entries.filter((entry) => entry.postId === post.id).map((entry) => entry.target.id));
          if (!storedTargetIds.size) continue;
          let changed = false;
          for (const target of post.targets || []) {
            if (!storedTargetIds.has(target.id)) continue;
            const outcome = outcomes.get(target.id) || { remoteCancel: 'not_required' };
            const failure = outcome.remoteCancel === 'failed';
            Object.assign(target, {
              pauseState: failure ? 'remote_cancel_failed' : 'paused',
              pauseReason: reason,
              pauseScope: scope.key,
              pausedAt,
              pausedBy: request.actor?.uid || 'operator',
              notificationState: failure ? 'notification_required' : 'none',
              ...(failure ? {
                lastError: {
                  ...(outcome.error || {}),
                  code: 'REMOTE_CANCEL_FAILED',
                  at: pausedAt,
                },
              } : {
                externalId: null,
                lastError: null,
              }),
            });
            changed = true;
          }
          if (changed) {
            post.status = migrateLegacyPost(post, post.clientId).status;
            bumpPostVersion(post);
            changedPosts.push(post);
          }
        }
        return changedPosts;
      });
      const remoteCancelFailedCount = [...outcomes.values()].filter((item) => item.remoteCancel === 'failed').length;
      const pause = {
        status: 'paused',
        scope: scope.scope,
        scopeKey: scope.key,
        accountId: scope.accountId,
        platformId: scope.platformId,
        reason,
        pausedAt,
        pausedBy: request.actor?.uid || 'operator',
        targetCount: entries.length,
        remoteCancelFailedCount,
      };
      await updateClientCrisisPause(client.id, pause, repositories);
      await appendVersions(updated);
      response.json({
        clientId: client.id,
        status: 'paused',
        pause,
        results: entries.map((entry) => resultFor(entry, outcomes.get(entry.target.id)?.remoteCancel === 'failed' ? 'remote_cancel_failed' : 'paused', outcomes.get(entry.target.id))),
      });
    } catch (error) {
      response.status(error.status || 400).json({ error: error.message || '無法啟用危機暫停。', code: error.code || 'CRISIS_PAUSE_FAILED' });
    }
  });

  router.post('/crisis-pause/resume', async (request, response) => {
    const clientId = String(request.body?.clientId || request.authorizedClientId || '').trim();
    const client = await getClient(clientId);
    if (!client) return response.status(404).json({ error: '找不到品牌。' });
    const pause = client.crisisPause;
    if (pause?.status !== 'paused') return response.json({ clientId: client.id, status: 'active', pause: null, results: [] });

    const scope = {
      scope: pause.scope || 'client',
      accountId: pause.accountId || null,
      platformId: pause.platformId || null,
      key: pause.scopeKey || 'client',
    };
    const entries = (await targetEntries(repositories, client.id, scope))
      .filter(({ target }) => target.pauseScope === scope.key || target.pauseState === 'remote_cancel_failed');
    const outcomes = new Map();
    for (const entry of entries) {
      const target = normalizeTarget(entry.target);
      try {
        let externalId = target.externalId || null;
        if (target.status === 'publishing') {
          outcomes.set(target.id, { status: 'resumed', externalId: target.externalId || null });
          continue;
        }
        if (target.platformId === 'facebook') {
          if (externalId) {
            const publisher = await resolveFacebookPublisher?.({ clientId: client.id, accountId: target.accountId });
            await cancelFacebookTarget({ publisher, target });
            externalId = null;
          }
          if (!target.scheduledAt) {
            const error = new Error('找不到恢復 Facebook 排程所需的原定時間。');
            error.code = 'RESUME_SCHEDULE_TIME_MISSING';
            throw error;
          }
          const publisher = await resolveFacebookPublisher?.({ clientId: client.id, accountId: target.accountId });
          const mediaPaths = resolveTargetMedia(migrateLegacyPost(
            (await repositories.posts.list()).find((post) => post.id === entry.postId),
            client.id,
          ), target);
          const result = await scheduleFacebookTarget({
            publisher,
            post: (await repositories.posts.list()).find((post) => post.id === entry.postId),
            target: { ...target, externalId: null },
            scheduledAt: target.scheduledAt,
            mediaFilePaths: await mediaFilePathsFromWebPaths(mediaPaths),
            mediaBuffers: await mediaBuffersFromWebPaths(mediaPaths),
          });
          externalId = result.externalId;
        }
        outcomes.set(target.id, { status: 'resumed', externalId });
      } catch (error) {
        outcomes.set(target.id, { status: 'remote_cancel_failed', error: safeError(error, 'RESUME_FAILED') });
      }
    }

    const updated = await repositories.posts.mutate((posts) => {
      const changedPosts = [];
      for (const post of posts) {
        if (post.clientId !== client.id) continue;
        let changed = false;
        for (const target of post.targets || []) {
          const outcome = outcomes.get(target.id);
          if (!outcome) continue;
          const failure = outcome.status !== 'resumed';
          Object.assign(target, {
            pauseState: failure ? 'remote_cancel_failed' : 'none',
            pauseReason: failure ? (outcome.error?.message || '恢復排程失敗。') : null,
            pauseScope: failure ? scope.key : null,
            pausedAt: failure ? target.pausedAt : null,
            pausedBy: failure ? target.pausedBy : null,
            notificationState: failure ? 'notification_required' : 'none',
            ...(failure ? {
              lastError: { ...(outcome.error || {}), at: new Date().toISOString() },
            } : {
              status: target.status === 'publishing' ? 'publishing' : 'scheduled',
              externalId: outcome.externalId || null,
              lastError: null,
            }),
          });
          changed = true;
        }
        if (changed) {
          post.status = migrateLegacyPost(post, post.clientId).status;
          bumpPostVersion(post);
          changedPosts.push(post);
        }
      }
      return changedPosts;
    });
    const failures = [...outcomes.values()].filter((item) => item.status !== 'resumed').length;
    const nextPause = failures
      ? { ...pause, lastResumeAt: new Date().toISOString(), remoteCancelFailedCount: failures }
      : null;
    await updateClientCrisisPause(client.id, nextPause, repositories);
    await appendVersions(updated);
    response.status(failures ? 409 : 200).json({
      clientId: client.id,
      status: failures ? 'paused' : 'active',
      pause: nextPause,
      results: entries.map((entry) => resultFor(entry, outcomes.get(entry.target.id)?.status || 'resumed', outcomes.get(entry.target.id))),
    });
  });

  return router;
}
