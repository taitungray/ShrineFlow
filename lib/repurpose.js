export const REPURPOSE_ALGORITHM_VERSION = 'saved-post-insights-v1';

export const REPURPOSE_METRIC_PRIORITY = Object.freeze({
  facebook: Object.freeze([
    'post_engaged_users',
    'reactions',
    'likes',
    'post_reactions_like_total',
    'post_engagements',
    'post_clicks',
    'post_media_view',
    'post_impressions',
  ]),
  instagram: Object.freeze(['saved', 'saves', 'comments', 'shares', 'likes', 'views']),
  threads: Object.freeze(['replies', 'reposts', 'quotes', 'shares', 'likes', 'views']),
});

function metricValue(metric = {}) {
  const values = Array.isArray(metric.values) ? metric.values : [];
  const latest = values.length ? values[values.length - 1]?.value : metric.value;
  const numeric = Number(latest);
  return Number.isFinite(numeric) ? numeric : null;
}

export function pickRepurposeMetric(platformId, data = []) {
  const byName = new Map((Array.isArray(data) ? data : []).map((metric) => [
    String(metric?.name || metric?.title || '').trim().toLowerCase(),
    metric,
  ]));
  const priority = REPURPOSE_METRIC_PRIORITY[platformId] || [];
  for (const name of priority) {
    const metric = byName.get(name);
    const value = metricValue(metric);
    if (value !== null) return { name, value };
  }
  return null;
}

export function rankRepurposeCandidates(records = [], {
  platformId = '',
  accountId = '',
  limit = 12,
} = {}) {
  const grouped = new Map();
  for (const record of records) {
    if (record?.status !== 'published') continue;
    if (platformId && record.platformId !== platformId) continue;
    if (accountId && record.accountId !== accountId) continue;
    const metric = pickRepurposeMetric(record.platformId, record.snapshot?.data);
    if (!metric) continue;
    const group = grouped.get(record.platformId) || [];
    group.push({ ...record, metric });
    grouped.set(record.platformId, group);
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 12, 1), 50);
  return [...grouped.entries()].flatMap(([groupPlatformId, group]) => group
    .sort((left, right) => right.metric.value - left.metric.value
      || new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0))
    .slice(0, safeLimit)
    .map((candidate, index) => {
      const { snapshot, ...safeCandidate } = candidate;
      return {
        ...safeCandidate,
        rank: index + 1,
        platformId: groupPlatformId,
        snapshotFetchedAt: snapshot?.fetchedAt || snapshot?.savedAt || null,
        snapshotSource: snapshot?.source || 'saved_insights_snapshot',
      };
    }))
    .sort((left, right) => left.platformId.localeCompare(right.platformId) || left.rank - right.rank);
}
