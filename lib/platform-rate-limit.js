export const PLATFORM_RATE_LIMIT_POLICY = Object.freeze({
  minIntervalMs: 250,
  maxConcurrent: 2,
  maxQueueSize: 20,
  maxBuckets: 100,
  idleTtlMs: 30 * 60 * 1000,
  retryAfterMs: 1_000,
});

export class ProviderRateLimitError extends Error {
  constructor(message = '平台請求過於頻繁，請稍後再試。', details = {}) {
    super(message);
    this.name = 'ProviderRateLimitError';
    this.code = 'PROVIDER_RATE_LIMIT_LOCAL';
    this.status = 429;
    this.retriable = true;
    this.retryAfterMs = details.retryAfterMs || PLATFORM_RATE_LIMIT_POLICY.retryAfterMs;
  }
}

const buckets = new Map();

function evictIdleBuckets(now = Date.now()) {
  for (const [key, bucket] of buckets) {
    if (!bucket.active && !bucket.queue.length && now - bucket.lastUsedAt > PLATFORM_RATE_LIMIT_POLICY.idleTtlMs) {
      buckets.delete(key);
    }
  }
  if (buckets.size <= PLATFORM_RATE_LIMIT_POLICY.maxBuckets) return;
  for (const [key, bucket] of [...buckets.entries()]
    .filter(([, item]) => !item.active && !item.queue.length)
    .sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt)) {
    if (buckets.size <= PLATFORM_RATE_LIMIT_POLICY.maxBuckets) break;
    buckets.delete(key);
  }
}

function getBucket(key) {
  const now = Date.now();
  evictIdleBuckets(now);
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = {
      active: 0,
      queue: [],
      lastStartedAt: 0,
      lastUsedAt: now,
      timer: null,
    };
    buckets.set(key, bucket);
  }
  bucket.lastUsedAt = now;
  return bucket;
}

function drain(key, bucket) {
  if (bucket.timer || bucket.active >= PLATFORM_RATE_LIMIT_POLICY.maxConcurrent || !bucket.queue.length) return;
  const waitMs = Math.max(0, PLATFORM_RATE_LIMIT_POLICY.minIntervalMs - (Date.now() - bucket.lastStartedAt));
  bucket.timer = setTimeout(() => {
    bucket.timer = null;
    const entry = bucket.queue.shift();
    if (!entry) return drain(key, bucket);
    bucket.active += 1;
    bucket.lastStartedAt = Date.now();
    bucket.lastUsedAt = bucket.lastStartedAt;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        bucket.active -= 1;
        bucket.lastUsedAt = Date.now();
        drain(key, bucket);
        evictIdleBuckets();
      });
    drain(key, bucket);
  }, waitMs);
}

export function scheduleProviderRequest(key, task) {
  const safeKey = String(key || 'provider:default').slice(0, 200);
  const bucket = getBucket(safeKey);
  if (bucket.queue.length >= PLATFORM_RATE_LIMIT_POLICY.maxQueueSize) {
    return Promise.reject(new ProviderRateLimitError());
  }
  return new Promise((resolve, reject) => {
    bucket.queue.push({ task, resolve, reject });
    bucket.lastUsedAt = Date.now();
    drain(safeKey, bucket);
  });
}

export function createRateLimitedFetch(fetchImpl, { platformId = 'provider', accountKey = 'default' } = {}) {
  const key = `${String(platformId).trim() || 'provider'}:${String(accountKey).trim() || 'default'}`;
  return (url, options) => scheduleProviderRequest(key, () => fetchImpl(url, options));
}

export function resetProviderRateLimitBuckets() {
  for (const bucket of buckets.values()) {
    if (bucket.timer) clearTimeout(bucket.timer);
    for (const entry of bucket.queue.splice(0)) entry.reject(new ProviderRateLimitError('平台請求節流器已重設。'));
  }
  buckets.clear();
}
