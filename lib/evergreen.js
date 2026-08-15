import { getRepositories } from './repositories.js';
import { makeId } from './store.js';
import { appendPostVersion } from './post-history.js';
import { bumpPostVersion } from './post-version.js';
import { addPostLifecycleEvent } from './post-lifecycle.js';
import {
  migrateLegacyPost,
  normalizeTarget,
  resolveTargetCopy,
  resolveTargetMedia,
  summarizePostStatus,
} from './post-targets.js';
import { appendErrorLog } from './error-log.js';

export const EVERGREEN_POLICY = Object.freeze({
  minIntervalDays: 1,
  maxIntervalDays: 90,
  minOccurrences: 1,
  maxOccurrences: 50,
});

function integer(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function normalizeEvergreenConfig(value = {}) {
  return {
    enabled: value.enabled === true,
    paused: value.paused === true,
    intervalDays: integer(value.intervalDays, 7),
    maxOccurrences: integer(value.maxOccurrences, 12),
    occurrenceCount: Math.max(0, integer(value.occurrenceCount, 0)),
    nextScheduledAt: value.nextScheduledAt || null,
    lastOccurrenceAt: value.lastOccurrenceAt || null,
    lastError: value.lastError || null,
    updatedAt: value.updatedAt || null,
  };
}

export function validateEvergreenSettings({ intervalDays, maxOccurrences } = {}) {
  const days = integer(intervalDays, NaN);
  const max = integer(maxOccurrences, NaN);
  if (!Number.isInteger(days) || days < EVERGREEN_POLICY.minIntervalDays || days > EVERGREEN_POLICY.maxIntervalDays) {
    return { ok: false, code: 'EVERGREEN_INTERVAL_INVALID', message: `Evergreen 間隔必須是 ${EVERGREEN_POLICY.minIntervalDays}～${EVERGREEN_POLICY.maxIntervalDays} 天。` };
  }
  if (!Number.isInteger(max) || max < EVERGREEN_POLICY.minOccurrences || max > EVERGREEN_POLICY.maxOccurrences) {
    return { ok: false, code: 'EVERGREEN_LIMIT_INVALID', message: `Evergreen 次數上限必須是 ${EVERGREEN_POLICY.minOccurrences}～${EVERGREEN_POLICY.maxOccurrences} 次。` };
  }
  return { ok: true, intervalDays: days, maxOccurrences: max };
}

function addDays(value, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function minimumFutureTime(now) {
  return new Date(new Date(now).getTime() + 60 * 1000);
}

function resolveNextTime({ requestedAt, config, sourceTarget, now }) {
  const fallbackBase = sourceTarget.publishedAt || now;
  const requested = requestedAt || config.nextScheduledAt || addDays(fallbackBase, config.intervalDays);
  const date = new Date(requested);
  if (Number.isNaN(date.getTime())) return null;
  const minimum = minimumFutureTime(now);
  return date > minimum ? date : minimum;
}

function buildEvergreenOccurrence(root, sourceTarget, sequence, scheduledAt, now) {
  const createdAt = new Date(now).toISOString();
  const target = normalizeTarget({
    accountId: sourceTarget.accountId,
    platformId: sourceTarget.platformId,
    contentType: sourceTarget.contentType,
    contentSettings: sourceTarget.contentSettings,
    timeZone: sourceTarget.timeZone,
    copyOverride: sourceTarget.copyOverride,
    mediaPaths: resolveTargetMedia(root, sourceTarget),
    status: 'scheduled',
    scheduledAt: scheduledAt.toISOString(),
    scheduleMode: 'manual',
    scheduleSource: 'local',
    delivery: sourceTarget.delivery?.firstComment?.text
      ? { firstComment: { text: sourceTarget.delivery.firstComment.text, status: 'pending' } }
      : undefined,
  });
  const occurrence = {
    ...root,
    id: makeId(),
    createdAt,
    updatedAt: createdAt,
    version: 1,
    status: 'scheduled',
    approvalState: 'draft',
    approvedVersion: null,
    createdBy: root.createdBy || null,
    updatedBy: null,
    archivedAt: null,
    archivedFromStatus: null,
    restoredAt: null,
    restoredFromVersionId: null,
    publishedAt: null,
    facebookPostId: null,
    externalId: null,
    evergreen: null,
    evergreenSource: {
      rootPostId: root.id,
      sourceTargetId: sourceTarget.id,
      sequence,
      scheduledAt: scheduledAt.toISOString(),
    },
    lifecycleEvents: [],
    targets: [target],
  };
  addPostLifecycleEvent(occurrence, 'evergreen_scheduled', {
    rootPostId: root.id,
    sourceTargetId: sourceTarget.id,
    sequence,
    scheduledAt: scheduledAt.toISOString(),
  }, createdAt);
  return occurrence;
}

export async function scheduleNextEvergreenOccurrence({
  sourcePostId,
  sourceTargetId = '',
  nextAt = null,
  now = new Date(),
  repositories = getRepositories(),
} = {}) {
  let result;
  try {
    result = await repositories.posts.mutate((posts) => {
      const rootStored = posts.find((post) => post.id === sourcePostId);
      if (!rootStored) return { status: 'source_not_found' };
      const root = migrateLegacyPost(rootStored, rootStored.clientId || '');
      const config = normalizeEvergreenConfig(root.evergreen);
      if (!config.enabled) return { status: 'disabled', root: rootStored };
      if (config.paused) return { status: 'paused', root: rootStored };
      const sourceTarget = root.targets.find((target) => target.id === sourceTargetId)
        || root.targets.find((target) => target.status === 'published');
      if (!sourceTarget || sourceTarget.status !== 'published') return { status: 'source_not_published', root: rootStored };
      const validation = validateEvergreenSettings(config);
      if (!validation.ok) return { status: 'invalid_config', error: validation };
      const sequence = config.occurrenceCount + 1;
      if (sequence > config.maxOccurrences) return { status: 'limit_reached', root: rootStored };
      const duplicate = posts.find((post) => (
        post.evergreenSource?.rootPostId === root.id
        && post.evergreenSource?.sourceTargetId === sourceTarget.id
        && Number(post.evergreenSource?.sequence) === sequence
      ));
      if (duplicate) return { status: 'already_scheduled', root: rootStored, occurrence: duplicate };
      const scheduledAt = resolveNextTime({ requestedAt: nextAt, config, sourceTarget, now });
      if (!scheduledAt) return { status: 'invalid_schedule_time', root: rootStored };
      const occurrence = buildEvergreenOccurrence(root, sourceTarget, sequence, scheduledAt, now);
      const nextScheduledAt = addDays(scheduledAt, config.intervalDays);
      const updatedConfig = {
        ...config,
        enabled: true,
        intervalDays: validation.intervalDays,
        maxOccurrences: validation.maxOccurrences,
        occurrenceCount: sequence,
        nextScheduledAt: nextScheduledAt?.toISOString() || null,
        lastOccurrenceAt: new Date(now).toISOString(),
        lastError: null,
        updatedAt: new Date(now).toISOString(),
      };
      Object.assign(rootStored, root, {
        evergreen: updatedConfig,
        updatedAt: new Date(now).toISOString(),
      });
      rootStored.status = summarizePostStatus(rootStored.targets);
      bumpPostVersion(rootStored);
      addPostLifecycleEvent(rootStored, 'evergreen_occurrence_scheduled', {
        occurrenceId: occurrence.id,
        sequence,
        scheduledAt: scheduledAt.toISOString(),
      }, new Date(now).toISOString());
      posts.push(occurrence);
      return { status: 'scheduled', root: rootStored, occurrence };
    });
  } catch (error) {
    await appendErrorLog({ scope: 'evergreen_schedule', error, retriable: true }).catch(() => {});
    return { status: 'failed', error: { message: error.message || 'Evergreen 排程失敗。', code: error.code || 'EVERGREEN_SCHEDULE_FAILED' } };
  }

  if (result?.status === 'scheduled') {
    try {
      await appendPostVersion({ post: result.root, source: 'evergreen_schedule' });
      await appendPostVersion({ post: result.occurrence, source: 'evergreen_schedule' });
    } catch (error) {
      await appendErrorLog({ scope: 'evergreen_history', error, retriable: true }).catch(() => {});
      return { ...result, historyPersisted: false, warning: 'Evergreen 已建立本機排程，但版本歷史寫入失敗。' };
    }
    return { ...result, historyPersisted: true };
  }
  return result;
}

export function resolveEvergreenCopy(post, target) {
  return resolveTargetCopy(post, target);
}
