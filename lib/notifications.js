import { jsonFiles, mutateJson, readJson } from './store.js';

export const NOTIFICATION_RETENTION_POLICY = Object.freeze({
  maxItems: 200,
  maxAgeDays: 180,
  maxMessageLength: 500,
});

function trim(value, maxLength = NOTIFICATION_RETENTION_POLICY.maxMessageLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function notificationItems(value) {
  if (!value || Array.isArray(value) || !Array.isArray(value.items)) return [];
  return value.items;
}

function pruneItems(items, now = Date.now()) {
  const cutoff = now - (NOTIFICATION_RETENTION_POLICY.maxAgeDays * 24 * 60 * 60 * 1000);
  return items
    .filter((item) => !item.readAt || !Number.isFinite(Date.parse(item.createdAt)) || Date.parse(item.createdAt) >= cutoff)
    .slice(-NOTIFICATION_RETENTION_POLICY.maxItems);
}

export async function appendScheduleFailureNotification({
  clientId,
  postId,
  targetId,
  platformId,
  attemptId,
  error,
  retriable = false,
} = {}) {
  const notification = {
    id: `schedule-failure-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type: 'schedule_failure',
    title: '排程發布失敗',
    clientId: trim(clientId, 120),
    postId: trim(postId, 120),
    targetId: trim(targetId, 120),
    platformId: trim(platformId, 40),
    attemptId: trim(attemptId, 120),
    message: trim(error?.message || error, NOTIFICATION_RETENTION_POLICY.maxMessageLength),
    code: trim(error?.code, 80),
    retriable: Boolean(retriable || error?.retriable),
    readAt: null,
    createdAt: new Date().toISOString(),
  };

  await mutateJson(jsonFiles.notifications, (record) => {
    const items = pruneItems(notificationItems(record));
    record.version = 1;
    record.items = [...items, notification].slice(-NOTIFICATION_RETENTION_POLICY.maxItems);
    return notification;
  }, { version: 1, items: [] });
  return notification;
}

export async function listNotifications({ unreadOnly = false, limit = 50, clientId = '' } = {}) {
  const record = await readJson(jsonFiles.notifications, { version: 1, items: [] });
  const items = pruneItems(notificationItems(record));
  const scoped = clientId ? items.filter((item) => !item.clientId || item.clientId === clientId) : items;
  const filtered = unreadOnly ? scoped.filter((item) => !item.readAt) : scoped;
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), NOTIFICATION_RETENTION_POLICY.maxItems);
  return filtered.slice(-safeLimit).reverse();
}

export async function markNotificationRead(notificationId) {
  const id = trim(notificationId, 120);
  if (!id) return null;
  return mutateJson(jsonFiles.notifications, (record) => {
    const item = notificationItems(record).find((entry) => entry.id === id);
    if (!item) return null;
    item.readAt = new Date().toISOString();
    record.version = 1;
    record.items = pruneItems(notificationItems(record));
    return item;
  }, { version: 1, items: [] });
}
