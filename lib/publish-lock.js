export const STALE_PUBLISHING_LOCK_MS = 5 * 60 * 1000;

export function isStalePublishingLock(target = {}, now = new Date()) {
  if (String(target.status || '') !== 'publishing') return false;
  if (String(target.externalId || '').trim()) return false;
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(current)) return false;
  if (target.leaseExpiresAt) {
    const expires = Date.parse(target.leaseExpiresAt);
    return Number.isFinite(expires) && expires <= current;
  }
  const startedAt = Date.parse(target.publishingStartedAt || target.lastAttemptAt || '');
  if (Number.isFinite(startedAt)) return current - startedAt >= STALE_PUBLISHING_LOCK_MS;
  return true;
}
