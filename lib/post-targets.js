import { makeId } from './store.js';

const MAX_TARGET_COPY_LENGTH = 5000;
export const MAX_TARGET_MEDIA_PATHS = 20;

const SCHEDULE_MODES = new Set(['manual', 'queue']);
const SCHEDULE_SOURCES = new Set(['local', 'facebook_native', 'remote_provider']);
const PAUSE_STATES = new Set(['none', 'paused', 'remote_cancel_failed']);
const NOTIFICATION_STATES = new Set(['none', 'notification_required', 'notified', 'failed']);

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || '').trim();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeFirstComment(value = {}) {
  if (!value || typeof value !== 'object') return {
    status: 'disabled',
    text: '',
    externalId: null,
    lastError: null,
    publishedAt: null,
  };
  const status = ['disabled', 'pending', 'published', 'failed'].includes(String(value.status || '').trim())
    ? String(value.status).trim()
    : (String(value.text || '').trim() ? 'pending' : 'disabled');
  return {
    status,
    text: String(value.text || '').trim().slice(0, 2000),
    externalId: value.externalId || null,
    lastError: value.lastError || null,
    publishedAt: value.publishedAt || null,
  };
}

export function normalizeMediaPaths(value) {
  if (!Array.isArray(value)) return null;
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, MAX_TARGET_MEDIA_PATHS);
}

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
    timeZone: String(raw.timeZone || '').trim() || null,
    scheduleMode: normalizeEnum(raw.scheduleMode, SCHEDULE_MODES, 'manual'),
    scheduleSource: normalizeEnum(raw.scheduleSource, SCHEDULE_SOURCES, null),
    queueId: String(raw.queueId || '').trim() || null,
    queueSlotId: String(raw.queueSlotId || '').trim() || null,
    queueSequence: Number.isFinite(Number(raw.queueSequence)) ? Number(raw.queueSequence) : null,
    queueAssignedAt: raw.queueAssignedAt || null,
    pauseState: normalizeEnum(raw.pauseState, PAUSE_STATES, 'none'),
    pauseReason: String(raw.pauseReason || '').trim().slice(0, 500) || null,
    pauseScope: String(raw.pauseScope || '').trim().slice(0, 120) || null,
    pausedAt: raw.pausedAt || null,
    pausedBy: String(raw.pausedBy || '').trim().slice(0, 120) || null,
    notificationState: normalizeEnum(raw.notificationState, NOTIFICATION_STATES, 'none'),
    delivery: {
      firstComment: normalizeFirstComment(raw.delivery?.firstComment || raw.firstComment),
    },
    copyOverride: raw.copyOverride === undefined || raw.copyOverride === null
      ? null
      : String(raw.copyOverride).slice(0, MAX_TARGET_COPY_LENGTH),
    mediaPaths: normalizeMediaPaths(raw.mediaPaths),
    scheduledAt: raw.scheduledAt || null,
    status: String(raw.status || 'draft').trim() || 'draft',
    externalId: raw.externalId || null,
    publishedAt: raw.publishedAt || null,
    lastError: raw.lastError || null,
    scheduleIdempotencyKey: String(raw.scheduleIdempotencyKey || '').trim() || null,
    attempts: Number(raw.attempts || 0),
    lastAttemptAt: raw.lastAttemptAt || null,
    publishingStartedAt: raw.publishingStartedAt || null,
    leaseId: raw.leaseId || null,
    leaseExpiresAt: raw.leaseExpiresAt || null,
    nextAttemptAt: raw.nextAttemptAt || null,
    lastAttemptId: raw.lastAttemptId || null,
    publishAttempts: Array.isArray(raw.publishAttempts) ? raw.publishAttempts.slice(-20) : [],
  };
}

export function summarizePostStatus(targets = []) {
  if (!Array.isArray(targets) || targets.length === 0) return 'draft';

  const statuses = targets.map((target) => String(target.status || 'draft'));
  const hasPublished = statuses.includes('published');
  const hasActive = statuses.some((status) => ['scheduled', 'publishing', 'retrying', 'pending'].includes(status));
  const hasUnfinished = statuses.some((status) => !['published', 'skipped_unsupported'].includes(status));

  if (hasPublished && hasUnfinished) return 'partial_success';
  if (hasActive) return 'scheduled';
  if (statuses.some((status) => status === 'failed')) return 'failed';
  if (statuses.every((status) => status === 'published' || status === 'skipped_unsupported')
    && hasPublished) {
    return 'published';
  }
  if (statuses.every((status) => status === 'published')) return 'published';
  return 'draft';
}

export function migrateLegacyPost(post = {}, defaultClientId = '') {
  if (Array.isArray(post.targets) && post.targets.length > 0) {
    const normalizedTargets = post.targets.map((target) => normalizeTarget(target));
    return {
      ...post,
      clientId: post.clientId || defaultClientId,
      targets: normalizedTargets,
      status: post.status === 'archived' ? 'archived' : summarizePostStatus(normalizedTargets),
    };
  }

  const platformId = String(post.channel || 'facebook').trim() || 'facebook';
  const accountId = String(post.accountId || '').trim() || `${platformId}:default`;
  const targetStatus = post.status === 'archived'
    ? 'draft'
    : (post.status === 'published'
      ? 'published'
      : (post.scheduledAt ? 'scheduled' : (post.status || 'draft')));

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
    status: post.status === 'archived' ? 'archived' : summarizePostStatus([target]),
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
