export const INSIGHTS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const INVALID_ID_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_LIVE_POST_SYNCS_PER_REQUEST = 8;

export function queryRequestsLiveRefresh(query = {}) {
  const value = String(query.refresh || query.fresh || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

export function snapshotAgeMs(snapshot, now = Date.now()) {
  const fetchedAt = Date.parse(snapshot?.fetchedAt || snapshot?.savedAt || '');
  if (!Number.isFinite(fetchedAt)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - fetchedAt);
}

export function isInvalidIdError(error) {
  if (!error) return false;
  if (error.category === 'invalid_id') return true;
  if (Number(error.subcode) === 33) return true;
  return /does not exist|invalid id|InvalidID|unsupported get request/i.test(String(error.message || ''));
}

export function snapshotIsInvalidId(snapshot) {
  return snapshot?.skipReason === 'invalid_id' || isInvalidIdError(snapshot?.error);
}

function parseClock(value) {
  if (value == null || value === '') return Number.NaN;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  return Date.parse(text);
}

export function accountSnapshotMatchesRange(snapshot, { since, until } = {}) {
  if (since == null && until == null) return true;
  const snapSince = Date.parse(snapshot?.range?.since);
  const snapUntil = Date.parse(snapshot?.range?.until);
  if (!Number.isFinite(snapSince) || !Number.isFinite(snapUntil)) return true;
  const reqSince = parseClock(since);
  const reqUntil = parseClock(until);
  if (!Number.isFinite(reqSince) || !Number.isFinite(reqUntil) || reqUntil <= reqSince) return true;
  return Math.round((snapUntil - snapSince) / 86400000) === Math.round((reqUntil - reqSince) / 86400000);
}

export function shouldUseCachedInsights(snapshot, {
  refresh = false,
  now = Date.now(),
  ttlMs = INSIGHTS_CACHE_TTL_MS,
  invalidTtlMs = INVALID_ID_CACHE_TTL_MS,
  range,
} = {}) {
  if (!snapshot) return false;
  const age = snapshotAgeMs(snapshot, now);
  if (snapshotIsInvalidId(snapshot)) return age < invalidTtlMs;
  if (refresh) return false;
  if (!snapshot.fetchedAt && !snapshot.savedAt) return false;
  if (range && !accountSnapshotMatchesRange(snapshot, range)) return false;
  return age < ttlMs;
}
