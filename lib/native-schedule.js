import { normalizePostCopy } from './copy-format.js';
import { resolveTargetCopy } from './post-targets.js';

export async function scheduleFacebookTarget({
  publisher,
  post,
  target,
  scheduledAt,
  mediaFilePaths = [],
  mediaBuffers = [],
}) {
  if (!publisher?.configured) {
    throw new Error('Facebook 帳號尚未設定完整。');
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
    mediaFilePaths,
    mediaBuffers,
    scheduledAt,
  });

  return {
    scheduledAt: new Date(scheduledAt).toISOString(),
    status: 'scheduled',
    externalId: result.externalId,
    lastError: null,
  };
}

export async function rescheduleFacebookTarget(args) {
  const { publisher, target } = args;
  if (target.externalId) {
    await publisher.deleteScheduled(target.externalId);
  }
  try {
    return await scheduleFacebookTarget(args);
  } catch (error) {
    error.remoteDeleted = Boolean(target.externalId);
    throw error;
  }
}

export async function cancelFacebookTarget({ publisher, target }) {
  if (target.externalId) {
    if (!publisher?.configured && !publisher?.deleteScheduled) {
      throw new Error('Facebook 帳號尚未設定完整。');
    }
    await publisher.deleteScheduled(target.externalId);
  }
  return {
    status: 'draft',
    scheduledAt: null,
    externalId: null,
    lastError: null,
  };
}
