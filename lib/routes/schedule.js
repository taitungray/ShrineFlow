import { Router } from 'express';
import { bumpPostVersion } from '../post-version.js';
import { getRepositories } from '../repositories.js';
import { getMediaStorage } from '../media-storage.js';
import { directories } from '../store.js';
import { getContentType } from '../platforms.js';
import { findAccount, listClientsRaw } from '../clients.js';
import {
  rejectLocalScheduleTooSoon,
  rejectScheduleContentType,
  resolveScheduleTime,
} from '../schedule-policy.js';
import {
  cancelFacebookTarget,
  rescheduleFacebookTarget,
  scheduleFacebookTarget,
} from '../native-schedule.js';
import {
  migrateLegacyPost,
  normalizeTarget,
  resolveTargetCopy,
  resolveTargetMedia,
  summarizePostStatus,
} from '../post-targets.js';
import { validateTargetFormat } from '../content-validation.js';
import { appendPostVersion } from '../post-history.js';
import { isPostArchived, isPostIdea } from '../post-lifecycle.js';
import { approvalGate } from '../approval-workflow.js';
import { appendErrorLog } from '../error-log.js';
import { filterAccessibleClients } from '../request-scope.js';
import { nextQueueSequence, nextQueueSlot, normalizeQueue } from '../queue.js';

function flattenScheduleRows(posts = [], clients = [], clientId = '') {
  const clientNameById = new Map(clients.map((client) => [client.id, client.name]));
  const rows = [];
  for (const post of posts) {
    if (clientId && post.clientId !== clientId) continue;
    if (isPostIdea(post)) continue;
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
        contentTopic: post.contentTopic || post.godName,
        godName: post.godName,
        channel: target.platformId,
        accountId: target.accountId,
        contentType: target.contentType,
        contentSettings: target.contentSettings || {},
        scheduledAt: target.scheduledAt,
        scheduleMode: target.scheduleMode || 'manual',
        scheduleSource: target.scheduleSource || null,
        queueId: target.queueId || null,
        queueSlotId: target.queueSlotId || null,
        queueSequence: target.queueSequence || null,
        pauseState: target.pauseState || 'none',
        timeZone: target.timeZone || null,
        status: target.status,
        publishedAt: target.publishedAt || null,
        externalId: target.externalId || null,
        firstComment: target.delivery?.firstComment || null,
        lastError: target.lastError || null,
        createdAt: post.createdAt,
      });
    }
  }
  return rows.sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0));
}

function crisisPauseBlocks(client, platformId, accountId) {
  const pause = client?.crisisPause;
  if (pause?.status !== 'paused') return false;
  if (pause.scope === 'account') return pause.accountId === accountId;
  if (pause.scope === 'platform') return pause.platformId === platformId;
  return true;
}

function mediaFilePathsFromWebPaths(mediaPaths = []) {
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

async function compensateRemoteSchedule(publisher, externalId) {
  if (!externalId) return { status: 'not_needed' };
  if (!publisher?.deleteScheduled) return { status: 'unavailable' };
  try {
    await publisher.deleteScheduled(externalId);
    return { status: 'compensated' };
  } catch (error) {
    return { status: 'failed', message: error.message || '無法取消遠端排程。' };
  }
}

async function reconcileScheduleAfterLocalFailure({
  publisher,
  result,
  postId,
  targetId,
  channel,
  cause,
}) {
  const compensation = await compensateRemoteSchedule(publisher, result.externalId);
  const remotePreserved = compensation.status !== 'compensated';
  const error = new Error(remotePreserved
    ? '平台已完成排程，但本地資料同步失敗；請先取消或確認平台上的排程。'
    : '平台排程已取消，但本地資料同步失敗，請重新整理後再試。');
  error.status = remotePreserved ? 503 : 409;
  error.code = remotePreserved
    ? 'REMOTE_SCHEDULE_RECONCILIATION_REQUIRED'
    : 'SCHEDULE_LOCAL_SYNC_FAILED';
  error.externalId = result.externalId || null;
  error.cause = cause?.message || cause?.error || '';

  const localError = {
    message: error.message,
    code: error.code,
    externalId: result.externalId || null,
    compensation: compensation.status,
    at: new Date().toISOString(),
  };
  try {
    await repositories.posts.mutate((storedPosts) => {
      const storedPost = storedPosts.find((item) => item.id === postId);
      const storedTarget = storedPost?.targets?.find((item) => item.id === targetId);
      if (!storedPost || !storedTarget) return { kind: 'missing' };
      Object.assign(storedTarget, {
        status: remotePreserved ? 'scheduled' : 'failed',
        scheduledAt: remotePreserved ? result.scheduledAt : null,
        externalId: remotePreserved ? result.externalId : null,
        lastError: localError,
      });
      storedPost.status = summarizePostStatus(storedPost.targets);
      bumpPostVersion(storedPost);
      return { kind: 'updated' };
    });
  } catch {
    // The error log below remains the durable fallback when the post cannot be updated.
  }
  await appendErrorLog({
    scope: 'schedule_reconciliation',
    error,
    platformId: channel,
    status: error.status,
  });
  return { error, compensation };
}

export function createScheduleRouter({ publishingPlatforms, resolveFacebookPublisher, repositories = getRepositories() }) {
  const router = Router();

  router.use('/schedule', (request, response, next) => {
    if (!['POST', 'PATCH'].includes(request.method)) return next();
    if (request.method === 'POST' && String(request.body?.scheduleMode || '').toLowerCase() === 'queue') return next();
    const resolution = resolveScheduleTime(request.body || {});
    if (!resolution.ok) {
      return response.status(400).json({ error: resolution.message, code: resolution.code });
    }
    request.body = {
      ...(request.body || {}),
      scheduledAt: resolution.scheduledAt,
      scheduleTimeZone: resolution.timeZone,
    };
    next();
  });

  router.get('/schedule', async (request, response) => {
    const clientId = String(request.query.clientId || '').trim();
    const [postsRaw, clients] = await Promise.all([
      repositories.posts.list(),
      listClientsRaw(repositories),
    ]);
    const posts = postsRaw.map((post) => migrateLegacyPost(post, post.clientId || clients[0]?.id || ''));
    response.json(flattenScheduleRows(filterAccessibleClients(posts, request, clientId), clients, clientId));
  });

  router.post('/schedule', async (request, response) => {
    const {
      postId,
      targetId = '',
      scheduledAt: requestedScheduledAt,
      scheduleMode: requestedScheduleMode = 'manual',
      channel = 'facebook',
      accountId = '',
      contentType = 'post',
      contentSettings = {},
    } = request.body || {};
    const scheduleMode = String(requestedScheduleMode || 'manual').toLowerCase() === 'queue' ? 'queue' : 'manual';
    let scheduledAt = requestedScheduledAt;

    if (!postId || (!scheduledAt && scheduleMode !== 'queue')) {
      return response.status(400).json({ error: '請選擇貼文與排程時間。' });
    }
    if (scheduledAt && Number.isNaN(new Date(scheduledAt).getTime())) {
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
    const clients = await listClientsRaw(repositories);
    const posts = await repositories.posts.list();
    const post = posts.find((item) => item.id === postId);
    if (!post) return response.status(404).json({ error: '找不到要排程的貼文。' });

    const normalized = migrateLegacyPost(post, post.clientId || clients[0]?.id || '');
    if (isPostIdea(normalized)) return response.status(409).json({ error: 'Ideas 尚未轉成草稿，不能直接排程。', code: 'IDEA_NOT_READY' });
    if (isPostArchived(normalized)) return response.status(409).json({ error: '封存中的貼文不能排程，請先還原。', code: 'POST_ARCHIVED' });
    const client = clients.find((item) => item.id === normalized.clientId) || null;
    const approval = approvalGate(normalized, client);
    if (!approval.allowed) {
      return response.status(409).json({
        error: approval.message,
        code: approval.code,
        approvalState: approval.state,
        currentVersion: Number(normalized.version || 1),
      });
    }
    const baseVersion = Number(normalized.version || 1);
    let target = targetId
      ? normalized.targets.find((item) => item.id === targetId)
        || normalized.targets.find((item) => item.accountId === targetId)
      : normalized.targets.find((item) => (
        item.accountId === accountId && item.platformId === channel && item.contentType === contentType
      ));
    if (targetId && !target) {
      const knownAccount = (client?.accounts || []).some((account) => account.id === targetId);
      if (!knownAccount) {
        return response.status(404).json({
          error: '找不到指定的排程目標。',
          code: 'SCHEDULE_TARGET_NOT_FOUND',
        });
      }
    }
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

    if (crisisPauseBlocks(client, channel, target.accountId)) {
      return response.status(409).json({
        error: '目前品牌的危機暫停仍啟用，請先恢復發布再建立新的排程。',
        code: 'CRISIS_PAUSE_ACTIVE',
      });
    }

    let queueAssignment = null;
    if (scheduleMode === 'queue') {
      const account = findAccount(client, target.accountId);
      if (!account) {
        return response.status(404).json({ error: '找不到佇列使用的平台連線。', code: 'QUEUE_ACCOUNT_NOT_FOUND' });
      }
      let queue;
      try {
        queue = normalizeQueue(account.queue, { accountId: account.id, platformId: channel });
      } catch (error) {
        return response.status(409).json({ error: error.message || '佇列設定無效。', code: 'QUEUE_CONFIG_INVALID' });
      }
      const existingSchedules = posts
        .filter((item) => item.clientId === normalized.clientId)
        .flatMap((item) => migrateLegacyPost(item, item.clientId || normalized.clientId).targets || [])
        .filter((item) => item.accountId === target.accountId && item.platformId === channel && item.id !== target.id);
      const assignment = nextQueueSlot({
        queue,
        fromDate: new Date(),
        existingSchedules,
        minimumLeadMs: channel === 'facebook' ? 10 * 60 * 1000 : 60 * 1000,
      });
      if (!assignment) {
        return response.status(409).json({ error: '目前沒有可用的佇列時段，請新增時段或暫停後再試。', code: 'QUEUE_NO_AVAILABLE_SLOT' });
      }
      queueAssignment = {
        ...assignment,
        queueSequence: nextQueueSequence(existingSchedules),
      };
      scheduledAt = assignment.scheduledAt;
      target.timeZone = assignment.timeZone;
    } else {
      target.timeZone = String(request.body?.scheduleTimeZone || target.timeZone || '').trim() || null;
    }

    if (channel === 'facebook' && !selectedContentType.canPublish) {
      return response.status(400).json({ error: `${platform.name} 的「${selectedContentType.name}」尚未串接發布功能。` });
    }

    const mediaPaths = resolveTargetMedia(normalized, target);
    const scheduledVideos = mediaPaths.filter((mediaPath) => /\.(avi|m4v|mov|mp4|mpeg|mpg|ogv|webm)$/i.test(mediaPath));
    if (channel === 'facebook' && scheduledVideos.length && mediaPaths.length !== 1) {
      return response.status(400).json({ error: 'Facebook 排程支援多張圖片或單一影片，暫不支援圖片與影片混合發布。' });
    }

    if (channel !== 'facebook') {
      const localScheduleError = rejectLocalScheduleTooSoon(scheduledAt);
      if (localScheduleError) return response.status(400).json({ error: localScheduleError });
    }

    const validation = await validateTargetFormat({
      platformId: channel,
      contentType,
      copy: resolveTargetCopy(normalized, target),
      mediaPaths,
      targetId: target.id,
      uploadsDirectory: directories.uploads,
    });
    if (!validation.valid) {
      return response.status(400).json({ error: validation.errors[0].message, validation });
    }

    let result = {
      scheduledAt: new Date(scheduledAt).toISOString(),
      status: 'scheduled',
      externalId: null,
      lastError: null,
    };
    let publisher = null;
    if (channel === 'facebook') {
      try {
        publisher = await resolveFacebookPublisher?.({
          clientId: normalized.clientId,
          accountId: target.accountId,
        });
        const scheduleArgs = {
          publisher,
          post: normalized,
          target: { ...target, contentType, contentSettings },
          scheduledAt,
          mediaFilePaths: mediaFilePathsFromWebPaths(mediaPaths),
          mediaBuffers: await mediaBuffersFromWebPaths(mediaPaths),
        };
        result = target.externalId
          ? await rescheduleFacebookTarget(scheduleArgs)
          : await scheduleFacebookTarget(scheduleArgs);
      } catch (error) {
        return response.status(400).json({ error: error.message || 'Facebook 排程失敗。' });
      }
    }

    let updated;
    try {
      updated = await repositories.posts.mutate((storedPosts) => {
      const storedPost = storedPosts.find((item) => item.id === postId);
      if (!storedPost) return { error: '找不到要排程的貼文。', status: 404 };
      const storedNormalized = migrateLegacyPost(storedPost, storedPost.clientId || normalized.clientId);
      if (Number(storedNormalized.version || 1) !== baseVersion) {
        return {
          error: '內容在排程期間已被修改，遠端排程已暫停同步。',
          code: 'POST_VERSION_CONFLICT',
          status: 409,
        };
      }
      let storedTarget = storedNormalized.targets.find((item) => item.id === target.id);
      if (!storedTarget && !storedPost.targets?.length && storedNormalized.targets.length === 1) {
        storedTarget = storedNormalized.targets[0];
        storedTarget.accountId = target.accountId;
      }
      if (!storedTarget) {
        storedTarget = normalizeTarget(target);
        storedNormalized.targets.push(storedTarget);
      }
      const queueFields = queueAssignment
        ? {
          scheduleMode: 'queue',
          queueId: queueAssignment.queueId,
          queueSlotId: queueAssignment.queueSlotId,
          queueSequence: queueAssignment.queueSequence,
          queueAssignedAt: new Date().toISOString(),
        }
        : {
          scheduleMode: 'manual',
          queueId: null,
          queueSlotId: null,
          queueSequence: null,
          queueAssignedAt: null,
        };
      Object.assign(storedTarget, {
        scheduledAt: result.scheduledAt,
        status: 'scheduled',
        contentType,
        contentSettings: contentSettings && typeof contentSettings === 'object' ? contentSettings : {},
        timeZone: target.timeZone,
        externalId: result.externalId,
        lastError: null,
        scheduleSource: channel === 'facebook' ? 'facebook_native' : 'local',
        ...queueFields,
      });
      delete storedTarget.nextAttemptAt;
      storedNormalized.status = summarizePostStatus(storedNormalized.targets);
      Object.assign(storedPost, storedNormalized);
      return {
        status: 201,
        post: storedPost,
        item: {
          id: storedTarget.id, postId: storedPost.id, targetId: storedTarget.id,
          clientId: storedPost.clientId, channel: storedTarget.platformId,
          accountId: storedTarget.accountId, contentType: storedTarget.contentType,
          contentSettings: storedTarget.contentSettings, timeZone: storedTarget.timeZone || null,
          scheduledAt: storedTarget.scheduledAt,
          status: storedTarget.status, externalId: storedTarget.externalId || null,
          scheduleMode: storedTarget.scheduleMode,
          scheduleSource: storedTarget.scheduleSource,
          queueId: storedTarget.queueId,
          queueSlotId: storedTarget.queueSlotId,
          queueSequence: storedTarget.queueSequence,
        },
      };
      });
    } catch (error) {
      const reconciliation = await reconcileScheduleAfterLocalFailure({
        publisher, result, postId, targetId: target.id, channel, cause: error,
      });
      return response.status(reconciliation.error.status).json({
        error: reconciliation.error.message,
        code: reconciliation.error.code,
        compensation: reconciliation.compensation.status,
      });
    }

    if (updated?.error) {
      const reconciliation = await reconcileScheduleAfterLocalFailure({
        publisher,
        result,
        postId,
        targetId: target.id,
        channel,
        cause: updated,
      });
      return response.status(reconciliation.error.status).json({
        error: reconciliation.error.message,
        code: reconciliation.error.code,
        compensation: reconciliation.compensation.status,
      });
    }
    await appendPostVersion({ post: updated.post, source: 'schedule' });
    response.status(201).json(updated.item);
  });

  router.patch('/schedule/:targetId', async (request, response) => {
    const targetId = String(request.params.targetId || '').trim();
    const { scheduledAt, scheduledLocal } = request.body || {};
    if (!targetId || (!scheduledAt && !scheduledLocal)) {
      return response.status(400).json({ error: '請提供排程目標與排程時間。' });
    }
    const resolvedTime = resolveScheduleTime({
      scheduledAt,
      scheduledLocal,
      timeZone: request.body?.timeZone || request.body?.scheduleTimeZone,
    });
    if (!resolvedTime.ok) {
      return response.status(400).json({ error: resolvedTime.message, code: resolvedTime.code });
    }
    const normalizedScheduledAt = resolvedTime.scheduledAt;

    const [posts, clients] = await Promise.all([
      repositories.posts.list(),
      listClientsRaw(repositories),
    ]);
    const post = posts.find((item) => (item.targets || []).some((target) => target.id === targetId));
    if (!post) return response.status(404).json({ error: '找不到排程目標。' });
    const normalized = migrateLegacyPost(post, post.clientId || clients[0]?.id || '');
    if (isPostIdea(normalized)) return response.status(409).json({ error: 'Ideas 尚未轉成草稿，不能直接排程。', code: 'IDEA_NOT_READY' });
    if (isPostArchived(normalized)) return response.status(409).json({ error: '封存中的貼文不能排程，請先還原。', code: 'POST_ARCHIVED' });
    const client = clients.find((item) => item.id === normalized.clientId) || null;
    const approval = approvalGate(normalized, client);
    if (!approval.allowed) {
      return response.status(409).json({
        error: approval.message,
        code: approval.code,
        approvalState: approval.state,
        currentVersion: Number(normalized.version || 1),
      });
    }
    const target = normalized.targets.find((item) => item.id === targetId);
    if (!target) return response.status(404).json({ error: '找不到排程目標。' });
    let result = {
      scheduledAt: normalizedScheduledAt,
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
          scheduledAt: normalizedScheduledAt,
          mediaFilePaths: mediaFilePathsFromWebPaths(mediaPaths),
          mediaBuffers: await mediaBuffersFromWebPaths(mediaPaths),
        });
      } catch (error) {
        if (error.remoteDeleted) {
          await repositories.posts.mutate((storedPosts) => {
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
            bumpPostVersion(storedPost);
          });
        }
        return response.status(error.remoteDeleted ? 502 : 400).json({
          error: error.message || 'Facebook 排程失敗。',
        });
      }
    } else {
      const localScheduleError = rejectLocalScheduleTooSoon(normalizedScheduledAt);
      if (localScheduleError) return response.status(400).json({ error: localScheduleError });
    }

    const updated = await repositories.posts.mutate((storedPosts) => {
      const storedPost = storedPosts.find((item) => item.id === post.id);
      const storedTarget = storedPost?.targets?.find((item) => item.id === targetId);
      if (!storedPost || !storedTarget) return { error: '找不到排程目標。', status: 404 };
      Object.assign(storedTarget, result, {
        timeZone: String(resolvedTime.timeZone || storedTarget.timeZone || '').trim() || null,
        scheduleMode: 'manual',
        scheduleSource: storedTarget.platformId === 'facebook' ? 'facebook_native' : 'local',
        queueId: null,
        queueSlotId: null,
        queueSequence: null,
        queueAssignedAt: null,
      });
      storedPost.status = summarizePostStatus(storedPost.targets);
      bumpPostVersion(storedPost);
      return { post: storedPost, status: 200, item: { ...storedTarget, postId: storedPost.id, targetId: storedTarget.id } };
    });
    if (updated?.error) return response.status(updated.status || 400).json({ error: updated.error });
    await appendPostVersion({ post: updated.post, source: 'schedule' });
    return response.json(updated.item);
  });

  router.delete('/schedule/:targetId', async (request, response) => {
    const targetId = String(request.params.targetId || '').trim();
    if (!targetId) return response.status(400).json({ error: '請提供排程目標。' });

    const [posts, clients] = await Promise.all([
      repositories.posts.list(),
      listClientsRaw(repositories),
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

    const updated = await repositories.posts.mutate((storedPosts) => {
      const storedPost = storedPosts.find((item) => item.id === post.id);
      const storedTarget = storedPost?.targets?.find((item) => item.id === targetId);
      if (!storedPost || !storedTarget) return { error: '找不到排程目標。', status: 404 };
      Object.assign(storedTarget, {
        status: 'draft',
        scheduledAt: null,
        externalId: null,
        lastError: null,
        scheduleMode: 'manual',
        scheduleSource: null,
        queueId: null,
        queueSlotId: null,
        queueSequence: null,
        queueAssignedAt: null,
      });
      storedPost.status = summarizePostStatus(storedPost.targets);
      bumpPostVersion(storedPost);
      return { post: storedPost, status: 200, item: { ...storedTarget, postId: storedPost.id, targetId: storedTarget.id } };
    });
    if (updated?.error) return response.status(updated.status || 400).json({ error: updated.error });
    await appendPostVersion({ post: updated.post, source: 'schedule' });
    return response.json(updated.item);
  });

  return router;
}
