import { makeId } from './store.js';

const MAX_TARGET_COPY_LENGTH = 5000;

export function normalizeTarget(raw = {}, defaults = {}) {
  const platformId = String(raw.platformId || defaults.platformId || 'facebook').trim();
  const accountId = String(raw.accountId || defaults.accountId || '').trim();
  return {
    id: String(raw.id || '').trim() || makeId(),
    accountId,
    platformId,
    contentType: String(raw.contentType || defaults.contentType || 'post').trim() || 'post',
    contentSettings: raw.contentSettings && typeof raw.contentSettings === 'object'
      ? { ...raw.contentSettings }
      : {},
    copyOverride: raw.copyOverride === undefined || raw.copyOverride === null
      ? null
      : String(raw.copyOverride).slice(0, MAX_TARGET_COPY_LENGTH),
    mediaPaths: Array.isArray(raw.mediaPaths) ? [...raw.mediaPaths] : (raw.mediaPaths === null ? null : null),
    scheduledAt: raw.scheduledAt || null,
    status: String(raw.status || 'draft').trim() || 'draft',
    externalId: raw.externalId || null,
    publishedAt: raw.publishedAt || null,
    lastError: raw.lastError || null,
    attempts: Number(raw.attempts || 0),
    lastAttemptAt: raw.lastAttemptAt || null,
    nextAttemptAt: raw.nextAttemptAt || null,
    lastAttemptId: raw.lastAttemptId || null,
    publishAttempts: Array.isArray(raw.publishAttempts) ? raw.publishAttempts.slice(-20) : [],
  };
}

export function summarizePostStatus(targets = []) {
  if (!Array.isArray(targets) || targets.length === 0) return 'draft';

  const statuses = targets.map((target) => String(target.status || 'draft'));
  if (statuses.some((status) => ['scheduled', 'publishing', 'retrying', 'pending'].includes(status))) {
    return 'scheduled';
  }
  if (statuses.some((status) => status === 'failed')) return 'failed';
  if (statuses.every((status) => status === 'published' || status === 'skipped_unsupported')
    && statuses.some((status) => status === 'published')) {
    return 'published';
  }
  if (statuses.every((status) => status === 'published')) return 'published';
  return 'draft';
}

export function migrateLegacyPost(post = {}, defaultClientId = '') {
  if (Array.isArray(post.targets) && post.targets.length > 0) {
    return {
      ...post,
      clientId: post.clientId || defaultClientId,
      targets: post.targets.map((target) => normalizeTarget(target)),
      status: summarizePostStatus(post.targets),
    };
  }

  const platformId = String(post.channel || 'facebook').trim() || 'facebook';
  const accountId = String(post.accountId || '').trim() || `${platformId}:default`;
  const targetStatus = post.status === 'published'
    ? 'published'
    : (post.scheduledAt ? 'scheduled' : (post.status || 'draft'));

  const target = normalizeTarget({
    accountId,
    platformId,
    contentType: post.contentType || 'post',
    contentSettings: post.contentSettings || {},
    scheduledAt: post.scheduledAt || null,
    status: ['pending', 'retrying'].includes(post.status) ? post.status : targetStatus,
    externalId: post.facebookPostId || post.externalId || null,
    publishedAt: post.publishedAt || null,
    lastError: post.lastError || null,
  });

  return {
    ...post,
    clientId: post.clientId || defaultClientId,
    targets: [target],
    status: summarizePostStatus([target]),
  };
}

export function resolveTargetCopy(post = {}, target = {}) {
  if (target.copyOverride != null && String(target.copyOverride).trim() !== '') {
    return String(target.copyOverride);
  }
  const contentType = String(target.contentType || 'post');
  if (contentType === 'reel') {
    return String(post.reel || post.reelCopy || post.facebook || post.facebookCopy || '');
  }
  return String(post.facebook || post.facebookCopy || '');
}

export function resolveTargetMedia(post = {}, target = {}) {
  if (Array.isArray(target.mediaPaths)) return [...target.mediaPaths];
  if (Array.isArray(post.mediaPaths) && post.mediaPaths.length) return [...post.mediaPaths];
  if (post.imagePath) return [post.imagePath];
  return [];
}
