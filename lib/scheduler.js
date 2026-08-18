import { bumpPostVersion } from './post-version.js';
import { directories, makeId } from './store.js';
import { getRepositories } from './repositories.js';
import { getMediaStorage } from './media-storage.js';
import { normalizePostCopy } from './copy-format.js';
import { createFacebookPublisher, FacebookPublishError } from './facebook.js';
import { createInstagramPublisher as createInstagramPublisherDefault } from './instagram.js';
import { createThreadsPublisher as createThreadsPublisherDefault } from './threads.js';
import { getClientRaw, findAccount, listClientsRaw } from './clients.js';
import { approvalGate } from './approval-workflow.js';
import {
  migrateLegacyPost,
  normalizeTarget,
  resolveTargetCopy,
  resolveTargetMedia,
  summarizePostStatus,
} from './post-targets.js';
import {
  appendPublishAttempt,
  createPublishAttempt,
  serializePublishError,
  updatePublishAttempt,
} from './publish-reliability.js';
import { recordPublishAttemptEvent } from './publish-attempt-log.js';
import { formatValidationError, validateTargetFormat } from './content-validation.js';
import { appendScheduleFailureNotification } from './notifications.js';
import { appendErrorLog } from './error-log.js';
import { appendPostVersion } from './post-history.js';
import { isPostArchived, isPostIdea } from './post-lifecycle.js';
import { scheduleNextEvergreenOccurrence } from './evergreen.js';
import { isStalePublishingLock } from './publish-lock.js';

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

export async function migrateScheduleIntoTargets({ repositories = getRepositories() } = {}) {
  const schedule = await repositories.schedule.list();
  if (!schedule.length) return 0;

  let migrated = 0;
  await repositories.posts.mutate((posts) => {
    for (const item of schedule) {
      if (!['pending', 'retrying', 'publishing'].includes(item.status)) continue;
      const post = posts.find((entry) => entry.id === item.postId);
      if (!post) continue;
      const normalized = migrateLegacyPost(post, post.clientId || '');
      let target = normalized.targets.find((entry) => (
        entry.accountId === item.accountId
        && entry.platformId === (item.channel || entry.platformId)
        && entry.contentType === (item.contentType || entry.contentType)
      ));
      if (!target) {
        target = normalizeTarget({
          accountId: item.accountId,
          platformId: item.channel || 'facebook',
          contentType: item.contentType || 'post',
          contentSettings: item.contentSettings || {},
        });
        normalized.targets.push(target);
      }
      target.scheduledAt = item.scheduledAt || target.scheduledAt;
      target.status = item.status === 'publishing' ? 'scheduled' : item.status;
      target.attempts = Number(item.attempts || target.attempts || 0);
      target.nextAttemptAt = item.nextAttemptAt || null;
      target.lastError = item.lastError || null;
      Object.assign(post, normalized, { status: summarizePostStatus(normalized.targets) });
      bumpPostVersion(post);
      migrated += 1;
    }
  });

  if (migrated > 0) {
    await repositories.schedule.mutate((entries) => {
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (['pending', 'retrying', 'publishing'].includes(entries[index].status)) {
          entries.splice(index, 1);
        }
      }
    });
  }
  return migrated;
}

export function shouldClaimTargetForLocalPublish(target, now = new Date()) {
  if (['paused', 'remote_cancel_failed'].includes(String(target.pauseState || '').trim())) return false;
  if (target.status === 'publishing') {
    return isStalePublishingLock(target, now);
  }
  if (!['scheduled', 'pending', 'retrying'].includes(target.status)) return false;
  if (target.platformId === 'facebook' && target.status === 'scheduled' && target.externalId) {
    return false;
  }
  const dueAt = target.status === 'retrying' ? target.nextAttemptAt : target.scheduledAt;
  if (!dueAt || new Date(dueAt) > now) return false;
  return true;
}

export function createScheduler({
  facebookPublisher,
  createPublisher = createFacebookPublisher,
  createInstagramPublisher = createInstagramPublisherDefault,
  createThreadsPublisher = createThreadsPublisherDefault,
  resolvePublicMediaBaseUrl = () => process.env.PUBLIC_MEDIA_BASE_URL || '',
  repositories = getRepositories(),
} = {}) {
  const schedulerIntervalMs = Math.max(5_000, Number(process.env.FACEBOOK_SCHEDULER_INTERVAL_MS) || 30_000);
  const schedulerMaxAttempts = Math.max(1, Number(process.env.FACEBOOK_SCHEDULER_MAX_ATTEMPTS) || 3);
  const schedulerRetryBaseMs = Math.max(5_000, Number(process.env.FACEBOOK_SCHEDULER_RETRY_BASE_MS) || 60_000);
  const schedulerLeaseMs = Math.max(30_000, Number(process.env.SHRINEFLOW_SCHEDULER_LEASE_MS) || 5 * 60_000);
  const schedulerMode = String(process.env.SHRINEFLOW_SCHEDULER_MODE || (process.env.NODE_ENV === 'production' ? 'cloud' : 'local')).toLowerCase();
  let schedulerRunning = false;

  async function claimDueTarget(now = new Date()) {
    const clients = await listClientsRaw();
    const clientById = new Map(clients.map((client) => [client.id, client]));
    return repositories.posts.mutate((posts) => {
      for (const post of posts) {
        const normalized = migrateLegacyPost(post, post.clientId || '');
        if (isPostArchived(normalized)) continue;
        if (isPostIdea(normalized)) continue;
        if (!approvalGate(normalized, clientById.get(normalized.clientId)).allowed) continue;
        post.clientId = normalized.clientId;
        if (!Array.isArray(post.targets) || post.targets.length === 0) {
          post.targets = normalized.targets;
        }

        for (const target of post.targets) {
          Object.assign(target, normalizeTarget(target));
          if (!shouldClaimTargetForLocalPublish(target, now)) continue;

          target.status = 'publishing';
          target.attempts = Number(target.attempts || 0) + 1;
          const attempt = createPublishAttempt({ source: 'scheduler', now });
          target.publishingStartedAt = attempt.startedAt;
          target.lastAttemptAt = attempt.startedAt;
          target.lastError = null;
          target.leaseId = attempt.id || makeId();
          target.leaseExpiresAt = new Date(now.getTime() + schedulerLeaseMs).toISOString();
          appendPublishAttempt(target, attempt);
          delete target.nextAttemptAt;
          post.status = summarizePostStatus(post.targets);
          return {
            postId: post.id,
            clientId: post.clientId,
            targetId: target.id,
            attempts: target.attempts,
            attempt,
            leaseId: target.leaseId,
            leaseExpiresAt: target.leaseExpiresAt,
            accountId: target.accountId,
            platformId: target.platformId,
          };
        }
      }
      return null;
    });
  }

  async function finishTarget(claim, result) {
    const publishedAt = new Date().toISOString();
    const finalizedPost = await repositories.posts.mutate((posts) => {
      const post = posts.find((entry) => entry.id === claim.postId);
      if (!post) return;
      const target = (post.targets || []).find((entry) => entry.id === claim.targetId);
      if (!target || target.leaseId !== claim.leaseId) return null;
      Object.assign(target, {
        status: 'published',
        publishedAt,
        externalId: result.externalId,
        lastError: null,
      });
      delete target.leaseId;
      delete target.leaseExpiresAt;
      delete target.publishingStartedAt;
      updatePublishAttempt(target, claim.attempt.id, {
        status: 'succeeded',
        finishedAt: publishedAt,
        externalId: result.externalId,
      });
      post.status = summarizePostStatus(post.targets);
      bumpPostVersion(post);
      post.publishedAt = publishedAt;
      if (claim.platformId === 'facebook') {
        post.facebookPostId = result.externalId;
      }
      return post;
    });
    if (!finalizedPost) {
      const error = new Error('Scheduler lease expired before publish finalization.');
      error.code = 'SCHEDULER_LEASE_LOST';
      error.retriable = true;
      throw error;
    }
    if (finalizedPost) {
      await appendPostVersion({ post: finalizedPost, source: 'publish', actor: 'scheduler' });
      if (finalizedPost.evergreenSource?.rootPostId) {
        await scheduleNextEvergreenOccurrence({
          sourcePostId: finalizedPost.evergreenSource.rootPostId,
          sourceTargetId: finalizedPost.evergreenSource.sourceTargetId,
          now: new Date(publishedAt),
          repositories,
        });
      }
    }
    return publishedAt;
  }

  async function finishFirstComment(claim, target, publisher, mediaId) {
    const firstComment = target.delivery?.firstComment;
    if (claim.platformId !== 'instagram' || !firstComment?.text) return null;
    const message = String(firstComment.text).trim().slice(0, 2000);
    let patch = { status: 'pending', text: message, lastError: null };
    try {
      if (typeof publisher?.publishFirstComment !== 'function') {
        const error = new Error('此 Instagram 連線尚未通過首則留言 capability 驗證。');
        error.code = 'FIRST_COMMENT_CAPABILITY_UNAVAILABLE';
        throw error;
      }
      const result = await publisher.publishFirstComment({ mediaId, text: message });
      patch = {
        status: 'published',
        text: message,
        externalId: result?.externalId || null,
        lastError: null,
        publishedAt: new Date().toISOString(),
      };
    } catch (error) {
      patch = {
        status: 'failed',
        text: message,
        lastError: serializePublishError(error),
      };
    }
    const finalizedPost = await repositories.posts.mutate((posts) => {
      const post = posts.find((entry) => entry.id === claim.postId);
      const currentTarget = post?.targets?.find((entry) => entry.id === claim.targetId);
      if (!post || !currentTarget) return null;
      currentTarget.delivery = currentTarget.delivery || {};
      currentTarget.delivery.firstComment = {
        ...(currentTarget.delivery.firstComment || {}),
        ...patch,
      };
      bumpPostVersion(post);
      return post;
    });
    if (finalizedPost) await appendPostVersion({ post: finalizedPost, source: 'first_comment', actor: 'scheduler' });
    return patch;
  }

  async function failTarget(claim, error) {
    const shouldRetry = Boolean(error?.retriable) && claim.attempts < schedulerMaxAttempts;
    const retryDelay = schedulerRetryBaseMs * (2 ** Math.max(0, claim.attempts - 1));
    const failure = await repositories.posts.mutate((posts) => {
      const post = posts.find((entry) => entry.id === claim.postId);
      if (!post) return null;
      const target = (post.targets || []).find((entry) => entry.id === claim.targetId);
      if (!target || target.leaseId !== claim.leaseId) return null;
      const lastError = serializePublishError(error);
      target.status = shouldRetry ? 'retrying' : 'failed';
      target.lastError = lastError;
      updatePublishAttempt(target, claim.attempt.id, {
        status: 'failed',
        finishedAt: lastError.at,
        error: lastError,
      });
      if (shouldRetry) target.nextAttemptAt = new Date(Date.now() + retryDelay).toISOString();
      delete target.leaseId;
      delete target.leaseExpiresAt;
      delete target.publishingStartedAt;
      post.status = summarizePostStatus(post.targets);
      bumpPostVersion(post);
      return {
        postId: post.id,
        targetId: target.id,
        platformId: target.platformId,
        attempt: target.publishAttempts?.find((item) => item.id === claim.attempt.id),
        occurredAt: lastError.at,
      };
    });
    if (failure?.attempt) {
      await recordPublishAttemptEvent({
        ...failure,
        eventType: 'failed',
      });
    }
    if (failure) {
      await appendScheduleFailureNotification({
        clientId: claim.clientId,
        postId: failure.postId,
        targetId: failure.targetId,
        platformId: failure.platformId,
        attemptId: claim.attempt.id,
        error,
        retriable: shouldRetry,
      });
      await appendErrorLog({
        scope: 'scheduler_publish',
        error,
        status: error?.status || null,
        platformId: failure.platformId,
        retriable: shouldRetry,
      });
    }
  }

  async function publisherForClaim(claim) {
    const client = await getClientRaw(claim.clientId);
    const account = findAccount(client, claim.accountId);
    if (claim.platformId === 'facebook') {
      if (account?.credentials?.pageId && account?.credentials?.pageAccessToken) {
        return createPublisher({
          pageId: account.credentials.pageId,
          pageAccessToken: account.credentials.pageAccessToken,
          graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
          graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
        });
      }
      return facebookPublisher;
    }
    if (claim.platformId === 'instagram') {
      return createInstagramPublisher({
        userId: account?.credentials?.userId,
        accessToken: account?.credentials?.accessToken,
        graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
        graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
        publicMediaBaseUrl: resolvePublicMediaBaseUrl(),
      });
    }
    if (claim.platformId === 'threads') {
      return createThreadsPublisher({
        userId: account?.credentials?.userId,
        accessToken: account?.credentials?.accessToken,
        graphVersion: process.env.THREADS_GRAPH_VERSION || 'v1.0',
        graphBaseUrl: process.env.THREADS_GRAPH_BASE_URL || 'https://graph.threads.net',
        publicMediaBaseUrl: resolvePublicMediaBaseUrl(),
      });
    }
    throw new Error(`不支援的發布平台：${claim.platformId}`);
  }

  async function processDueSchedules(now = new Date()) {
    if (schedulerRunning) return { processed: 0, skipped: true };
    schedulerRunning = true;
    let processedCount = 0;
    try {
      for (let processed = 0; processed < 10; processed += 1) {
        const claim = await claimDueTarget(now);
        if (!claim) break;
        processedCount += 1;
        try {
          await recordPublishAttemptEvent({
            postId: claim.postId,
            targetId: claim.targetId,
            platformId: claim.platformId,
            attempt: claim.attempt,
            eventType: 'started',
            occurredAt: claim.attempt.startedAt,
          });
          const posts = await repositories.posts.list();
          const post = posts.find((entry) => entry.id === claim.postId);
          if (!post) throw new FacebookPublishError('排程所屬的草稿已不存在。');
          const target = (post.targets || []).find((entry) => entry.id === claim.targetId);
          if (!target) throw new FacebookPublishError('排程目標已不存在。');

          const approval = approvalGate(post, await getClientRaw(post.clientId));
          if (!approval.allowed) {
            const error = new FacebookPublishError(approval.message);
            error.status = 409;
            error.code = approval.code;
            throw error;
          }
          const publisher = await publisherForClaim(claim);
          if (!publisher?.configured) {
            const platformName = {
              facebook: 'Facebook',
              instagram: 'Instagram',
              threads: 'Threads',
            }[claim.platformId] || claim.platformId;
            throw new FacebookPublishError(`${platformName} 帳號尚未設定完整。`);
          }

          const copy = resolveTargetCopy(post, target);
          const publishPost = normalizePostCopy({
            ...post,
            facebook: target.contentType === 'reel' ? post.facebook : copy,
            reel: target.contentType === 'reel' ? copy : post.reel,
          });
          const mediaPaths = resolveTargetMedia(post, target);
          const contentType = claim.platformId === 'instagram' && (!target.contentType || target.contentType === 'post')
            ? 'feed'
            : (target.contentType || 'post');
          const publishOptions = {
            contentType,
            contentSettings: target.contentSettings || {},
          };
          if (claim.platformId === 'facebook') {
            publishOptions.mediaFilePaths = mediaFilePathsFromWebPaths(mediaPaths);
            if (!publishOptions.mediaFilePaths.length && mediaPaths.length) {
              publishOptions.mediaBuffers = await mediaBuffersFromWebPaths(mediaPaths);
            }
          } else {
            publishOptions.mediaWebPaths = mediaPaths;
          }
          const validation = await validateTargetFormat({
            platformId: claim.platformId,
            contentType,
            copy,
            mediaPaths,
            targetId: target.id,
            uploadsDirectory: directories.uploads,
          });
          if (!validation.valid) throw formatValidationError(validation);
          const result = await publisher.publish(publishPost, publishOptions);
          const publishedAt = await finishTarget(claim, result);
          const firstComment = await finishFirstComment(claim, target, publisher, result.externalId);
          await recordPublishAttemptEvent({
            postId: claim.postId,
            targetId: claim.targetId,
            platformId: claim.platformId,
            attempt: {
              ...claim.attempt,
              status: 'succeeded',
              finishedAt: publishedAt,
              externalId: result.externalId,
            },
            eventType: 'succeeded',
            occurredAt: publishedAt,
          });
          if (firstComment?.status === 'failed') {
            await appendErrorLog({
              scope: 'scheduler_first_comment',
              error: firstComment.lastError,
              platformId: claim.platformId,
              postId: claim.postId,
              targetId: claim.targetId,
            });
          }
          console.log(`${claim.platformId} target published: ${result.externalId}`);
        } catch (error) {
          console.error('Scheduled target publish failed:', error);
          await failTarget(claim, error);
        }
      }
      return { processed: processedCount, skipped: false };
    } finally {
      schedulerRunning = false;
    }
  }

  function startTimer() {
    if (schedulerMode === 'cloud') return null;
    const timer = setInterval(
      () => processDueSchedules().catch((error) => console.error('Target scheduler failed:', error)),
      schedulerIntervalMs,
    );
    timer.unref?.();
    return timer;
  }

  return {
    intervalMs: schedulerIntervalMs,
    mode: schedulerMode,
    isRunning: () => schedulerRunning,
    processDueSchedules,
    startTimer,
  };
}
