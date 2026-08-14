export const BEST_TIMES_ALGORITHM_VERSION = 'local-publish-v1';
export const DEFAULT_MIN_BEST_TIME_SAMPLES = 10;

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

function validTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return timeZone;
  } catch {
    return 'Asia/Taipei';
  }
}

function partsOf(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[
    parts.find((part) => part.type === 'weekday')?.value
  ];
  return {
    weekday: Number.isInteger(weekday) ? weekday : 0,
    hour: Number(parts.find((part) => part.type === 'hour')?.value || 0),
  };
}

function dateRange(records) {
  const timestamps = records
    .map((record) => new Date(record.publishedAt || 0).getTime())
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  return timestamps.length
    ? { since: new Date(timestamps[0]).toISOString(), until: new Date(timestamps[timestamps.length - 1]).toISOString() }
    : { since: null, until: null };
}

export function analyzeBestTimes(records = [], {
  clientId = '',
  platformId = '',
  accountId = '',
  timeZone = 'Asia/Taipei',
  minSamples = DEFAULT_MIN_BEST_TIME_SAMPLES,
} = {}) {
  const resolvedTimeZone = validTimeZone(timeZone);
  const filtered = records.filter((record) => {
    if (clientId && record.clientId !== clientId) return false;
    if (platformId && record.platformId !== platformId) return false;
    if (accountId && record.accountId !== accountId) return false;
    if (record.status !== 'published') return false;
    const timestamp = new Date(record.publishedAt || 0).getTime();
    return Number.isFinite(timestamp) && timestamp > 0;
  });
  const buckets = new Map();
  filtered.forEach((record) => {
    const date = new Date(record.publishedAt);
    const { weekday, hour } = partsOf(date, resolvedTimeZone);
    const key = `${weekday}:${hour}`;
    const bucket = buckets.get(key) || { weekday, hour, sampleCount: 0 };
    bucket.sampleCount += 1;
    buckets.set(key, bucket);
  });
  const maxCount = Math.max(...[...buckets.values()].map((bucket) => bucket.sampleCount), 0);
  const slots = [...buckets.values()]
    .sort((left, right) => right.sampleCount - left.sampleCount || left.weekday - right.weekday || left.hour - right.hour)
    .slice(0, 3)
    .map((bucket) => ({
      weekday: bucket.weekday,
      weekdayLabel: WEEKDAY_NAMES[bucket.weekday],
      localHour: `${String(bucket.hour).padStart(2, '0')}:00`,
      sampleCount: bucket.sampleCount,
      score: maxCount ? Number((bucket.sampleCount / maxCount).toFixed(2)) : 0,
    }));
  const sampleCount = filtered.length;
  const enoughData = sampleCount >= Math.max(1, Number(minSamples) || DEFAULT_MIN_BEST_TIME_SAMPLES);
  return {
    status: enoughData ? 'ok' : 'insufficient_data',
    timeZone: resolvedTimeZone,
    dataRange: dateRange(filtered),
    metric: 'published_target_count',
    sampleCount,
    minimumSamples: Math.max(1, Number(minSamples) || DEFAULT_MIN_BEST_TIME_SAMPLES),
    source: 'local_published_targets',
    algorithmVersion: BEST_TIMES_ALGORITHM_VERSION,
    dataQuality: enoughData ? 'exploratory' : 'insufficient',
    slots: enoughData ? slots : [],
  };
}

export function publishedTargetRecords(posts = []) {
  return posts.flatMap((post) => (Array.isArray(post.targets) ? post.targets : []).map((target) => ({
    clientId: post.clientId || '',
    accountId: target.accountId || '',
    platformId: target.platformId || '',
    status: target.status || '',
    publishedAt: target.publishedAt || post.publishedAt || null,
  })));
}
