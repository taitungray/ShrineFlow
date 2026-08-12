import { mutateJson, readJson, jsonFiles } from './store.js';
import { resolvePostMediaPaths } from './upload.js';
import { normalizePostCopy } from './copy-format.js';
import { FacebookPublishError } from './facebook.js';

export function createScheduler({ facebookPublisher }) {
  const schedulerIntervalMs = Math.max(5_000, Number(process.env.FACEBOOK_SCHEDULER_INTERVAL_MS) || 30_000);
  const schedulerMaxAttempts = Math.max(1, Number(process.env.FACEBOOK_SCHEDULER_MAX_ATTEMPTS) || 3);
  const schedulerRetryBaseMs = Math.max(5_000, Number(process.env.FACEBOOK_SCHEDULER_RETRY_BASE_MS) || 60_000);
  let schedulerRunning = false;

  async function claimDueSchedule(now = new Date()) {
    return mutateJson(jsonFiles.schedule, (schedule) => {
      const item = schedule.find((entry) => {
        if (!['pending', 'retrying'].includes(entry.status) || entry.channel !== 'facebook') return false;
        const dueAt = entry.status === 'retrying' ? entry.nextAttemptAt : entry.scheduledAt;
        return dueAt && new Date(dueAt) <= now;
      });
      if (!item) return null;
      item.status = 'publishing';
      item.attempts = Number(item.attempts || 0) + 1;
      item.lastAttemptAt = now.toISOString();
      delete item.nextAttemptAt;
      return { ...item };
    });
  }

  async function finishSchedule(scheduleItem, result) {
    const publishedAt = new Date().toISOString();
    await mutateJson(jsonFiles.schedule, (schedule) => {
      const item = schedule.find((entry) => entry.id === scheduleItem.id);
      if (!item) return;
      Object.assign(item, {
        status: 'published',
        publishedAt,
        facebookPostId: result.externalId,
        facebookPhotoId: result.photoId,
        facebookPhotoIds: result.photoIds,
        facebookVideoId: result.videoId,
      });
      delete item.lastError;
    });
    await mutateJson(jsonFiles.posts, (posts) => {
      const post = posts.find((entry) => entry.id === scheduleItem.postId);
      if (post) Object.assign(post, { status: 'published', publishedAt, facebookPostId: result.externalId });
    });
  }

  async function failSchedule(scheduleItem, error) {
    const shouldRetry = Boolean(error?.retriable) && scheduleItem.attempts < schedulerMaxAttempts;
    const retryDelay = schedulerRetryBaseMs * (2 ** Math.max(0, scheduleItem.attempts - 1));
    await mutateJson(jsonFiles.schedule, (schedule) => {
      const item = schedule.find((entry) => entry.id === scheduleItem.id);
      if (!item) return;
      item.status = shouldRetry ? 'retrying' : 'failed';
      item.lastError = {
        message: error?.message || 'Facebook 發布失敗。',
        code: error?.code,
        subcode: error?.subcode,
        traceId: error?.traceId,
        at: new Date().toISOString(),
      };
      if (shouldRetry) item.nextAttemptAt = new Date(Date.now() + retryDelay).toISOString();
    });
  }

  async function processDueSchedules() {
    if (schedulerRunning || !facebookPublisher.configured) return;
    schedulerRunning = true;
    try {
      for (let processed = 0; processed < 10; processed += 1) {
        const scheduleItem = await claimDueSchedule();
        if (!scheduleItem) break;
        try {
          const posts = await readJson(jsonFiles.posts, []);
          const post = posts.find((entry) => entry.id === scheduleItem.postId);
          if (!post) throw new FacebookPublishError('排程所屬的草稿已不存在。');
          const result = await facebookPublisher.publish(normalizePostCopy(post), {
            mediaFilePaths: resolvePostMediaPaths(post),
          });
          await finishSchedule(scheduleItem, result);
          console.log(`Facebook post published: ${result.externalId}`);
        } catch (error) {
          console.error('Facebook scheduled publish failed:', error);
          await failSchedule(scheduleItem, error);
        }
      }
    } finally {
      schedulerRunning = false;
    }
  }

  function startTimer() {
    if (!facebookPublisher.configured) return null;
    const timer = setInterval(
      () => processDueSchedules().catch((error) => console.error('Facebook scheduler failed:', error)),
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
