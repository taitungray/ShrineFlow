import path from 'node:path';
import { mutateJson, readJson, jsonFiles, directories } from './store.js';
import { normalizePostCopy } from './copy-format.js';
import { createFacebookPublisher, FacebookPublishError } from './facebook.js';
import { getClientRaw, findAccount } from './clients.js';
import {
  migrateLegacyPost,
  normalizeTarget,
  resolveTargetCopy,
  resolveTargetMedia,
  summarizePostStatus,
} from './post-targets.js';

function mediaFilePathsFromWebPaths(mediaPaths = []) {
  return mediaPaths
    .filter((mediaPath) => String(mediaPath).startsWith('/uploads/'))
    .map((mediaPath) => path.join(directories.uploads, path.basename(String(mediaPath))));
}

export async function migrateScheduleIntoTargets() {
  const schedule = await readJson(jsonFiles.schedule, []);
  if (!schedule.length) return 0;

  let migrated = 0;
  await mutateJson(jsonFiles.posts, (posts) => {
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
      migrated += 1;
    }
  });

  if (migrated > 0) {
    await mutateJson(jsonFiles.schedule, (entries) => {
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
  if (!['scheduled', 'pending', 'retrying'].includes(target.status)) return false;
  if (target.platformId === 'facebook' && target.status === 'scheduled' && target.externalId) {
    return false;
  }
  const dueAt = target.status === 'retrying' ? target.nextAttemptAt : target.scheduledAt;
  if (!dueAt || new Date(dueAt) > now) return false;
  return true;
}

export function createScheduler({ facebookPublisher, createPublisher = createFacebookPublisher } = {}) {
  const schedulerIntervalMs = Math.max(5_000, Number(process.env.FACEBOOK_SCHEDULER_INTERVAL_MS) || 30_000);
  const schedulerMaxAttempts = Math.max(1, Number(process.env.FACEBOOK_SCHEDULER_MAX_ATTEMPTS) || 3);
  const schedulerRetryBaseMs = Math.max(5_000, Number(process.env.FACEBOOK_SCHEDULER_RETRY_BASE_MS) || 60_000);
  let schedulerRunning = false;

  async function claimDueTarget(now = new Date()) {
    return mutateJson(jsonFiles.posts, (posts) => {
      for (const post of posts) {
        const normalized = migrateLegacyPost(post, post.clientId || '');
        post.clientId = normalized.clientId;
        if (!Array.isArray(post.targets) || post.targets.length === 0) {
          post.targets = normalized.targets;
        }

        for (const target of post.targets) {
          Object.assign(target, normalizeTarget(target));
          if (!shouldClaimTargetForLocalPublish(target, now)) continue;

          if (target.platformId !== 'facebook') {
            target.status = 'skipped_unsupported';
            target.lastError = {
              message: `${target.platformId} 發布尚未支援。`,
              at: now.toISOString(),
            };
            post.status = summarizePostStatus(post.targets);
            continue;
          }

          target.status = 'publishing';
          target.attempts = Number(target.attempts || 0) + 1;
          target.lastAttemptAt = now.toISOString();
          delete target.nextAttemptAt;
          post.status = summarizePostStatus(post.targets);
          return {
            postId: post.id,
            clientId: post.clientId,
            targetId: target.id,
            attempts: target.attempts,
            accountId: target.accountId,
          };
        }
      }
      return null;
    });
  }

  async function finishTarget(claim, result) {
    const publishedAt = new Date().toISOString();
    await mutateJson(jsonFiles.posts, (posts) => {
      const post = posts.find((entry) => entry.id === claim.postId);
      if (!post) return;
      const target = (post.targets || []).find((entry) => entry.id === claim.targetId);
      if (!target) return;
      Object.assign(target, {
        status: 'published',
        publishedAt,
        externalId: result.externalId,
        lastError: null,
      });
      post.status = summarizePostStatus(post.targets);
      post.publishedAt = publishedAt;
      post.facebookPostId = result.externalId;
    });
  }

  async function failTarget(claim, error) {
    const shouldRetry = Boolean(error?.retriable) && claim.attempts < schedulerMaxAttempts;
    const retryDelay = schedulerRetryBaseMs * (2 ** Math.max(0, claim.attempts - 1));
    await mutateJson(jsonFiles.posts, (posts) => {
      const post = posts.find((entry) => entry.id === claim.postId);
      if (!post) return;
      const target = (post.targets || []).find((entry) => entry.id === claim.targetId);
      if (!target) return;
      target.status = shouldRetry ? 'retrying' : 'failed';
      target.lastError = {
        message: error?.message || 'Facebook 發布失敗。',
        code: error?.code,
        subcode: error?.subcode,
        traceId: error?.traceId,
        at: new Date().toISOString(),
      };
      if (shouldRetry) target.nextAttemptAt = new Date(Date.now() + retryDelay).toISOString();
      post.status = summarizePostStatus(post.targets);
    });
  }

  async function publisherForClaim(claim) {
    const client = await getClientRaw(claim.clientId);
    const account = findAccount(client, claim.accountId);
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

  async function processDueSchedules(now = new Date()) {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      for (let processed = 0; processed < 10; processed += 1) {
        const claim = await claimDueTarget(now);
        if (!claim) break;
        try {
          const posts = await readJson(jsonFiles.posts, []);
          const post = posts.find((entry) => entry.id === claim.postId);
          if (!post) throw new FacebookPublishError('排程所屬的草稿已不存在。');
          const target = (post.targets || []).find((entry) => entry.id === claim.targetId);
          if (!target) throw new FacebookPublishError('排程目標已不存在。');

          const publisher = await publisherForClaim(claim);
          if (!publisher?.configured) {
            throw new FacebookPublishError('Facebook 帳號尚未設定完整。');
          }

          const copy = resolveTargetCopy(post, target);
          const publishPost = normalizePostCopy({
            ...post,
            facebook: target.contentType === 'reel' ? post.facebook : copy,
            reel: target.contentType === 'reel' ? copy : post.reel,
          });
          const result = await publisher.publish(publishPost, {
            contentType: target.contentType || 'post',
            contentSettings: target.contentSettings || {},
            mediaFilePaths: mediaFilePathsFromWebPaths(resolveTargetMedia(post, target)),
          });
          await finishTarget(claim, result);
          console.log(`Facebook target published: ${result.externalId}`);
        } catch (error) {
          console.error('Scheduled target publish failed:', error);
          await failTarget(claim, error);
        }
      }
    } finally {
      schedulerRunning = false;
    }
  }

  function startTimer() {
    const timer = setInterval(
      () => processDueSchedules().catch((error) => console.error('Target scheduler failed:', error)),
      schedulerIntervalMs,
    );
    timer.unref?.();
    return timer;
  }

  return {
    intervalMs: schedulerIntervalMs,
    processDueSchedules,
    startTimer,
  };
}
