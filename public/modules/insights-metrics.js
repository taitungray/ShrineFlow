const SNAPSHOT_METRICS = new Set(['page_fans', 'page_follows', 'follower_count', 'followers_count']);
const LIVE_STATUS = new Set(['synced', 'cached']);

function actionTypeCounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const likes = Number(value.like ?? value.likes ?? value.reaction ?? value.reactions);
  const comments = Number(value.comment ?? value.comments ?? value.reply ?? value.replies);
  const shares = Number(value.share ?? value.shares ?? value.repost ?? value.reposts);
  const parsed = {
    likes: Number.isFinite(likes) ? likes : null,
    comments: Number.isFinite(comments) ? comments : null,
    shares: Number.isFinite(shares) ? shares : null,
  };
  return parsed.likes == null && parsed.comments == null && parsed.shares == null ? null : parsed;
}

export function metricDisplayValue(metric) {
  if (metric?.value !== undefined && metric?.value !== null && metric?.value !== '') return metric.value;
  const totalValue = metric?.total_value?.value ?? metric?.total_value;
  if (totalValue !== undefined && totalValue !== null && totalValue !== '' && typeof totalValue !== 'object') {
    return totalValue;
  }
  const values = Array.isArray(metric?.values) ? metric.values : [];
  if (!values.length) return undefined;
  const name = String(metric.name || '');
  if (SNAPSHOT_METRICS.has(name) || values.some((item) => item?.value && typeof item.value === 'object')) {
    return values[values.length - 1]?.value;
  }
  const numbers = values.map((item) => Number(item.value)).filter((value) => Number.isFinite(value));
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : values[values.length - 1]?.value;
}

function numericMetricValue(metric) {
  const value = metricDisplayValue(metric);
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function extractMetricVal(source, metricNames = []) {
  if (!Array.isArray(source?.data)) return null;
  let foundZero = false;
  for (const name of metricNames) {
    const found = source.data.find((metric) => metric.name === name);
    if (!found) continue;
    const num = numericMetricValue(found);
    if (num === null) continue;
    if (num > 0) return num;
    foundZero = true;
  }
  return foundZero ? 0 : null;
}

function activityFromSource(source) {
  const metric = (source?.data || []).find((item) => item.name === 'post_activity_by_action_type');
  if (!metric) return null;
  const value = metricDisplayValue(metric);
  return actionTypeCounts(value);
}

export function extractAllMetrics(source) {
  const empty = {
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    reach: null,
    total: null,
    available: false,
  };
  if (!source || !Array.isArray(source.data)) return empty;

  const likes = extractMetricVal(source, [
    'post_reactions_like_total',
    'reactions',
    'likes',
    'page_actions_post_reactions_like_total',
  ]);
  const comments = extractMetricVal(source, ['comments', 'replies']);
  const shares = extractMetricVal(source, ['shares', 'reposts']);
  const saves = extractMetricVal(source, ['saves', 'saved']);
  const reach = extractMetricVal(source, [
    'post_total_media_view_unique',
    'reach',
    'views',
    'post_media_view',
    'post_impressions',
    'post_impressions_organic',
    'page_posts_impressions_unique',
  ]);
  const activity = activityFromSource(source);
  const resolved = {
    likes: likes ?? activity?.likes ?? null,
    comments: comments ?? activity?.comments ?? null,
    shares: shares ?? activity?.shares ?? null,
    saves,
    reach,
  };
  const totalDirect = extractMetricVal(source, [
    'total_interactions',
    'post_engaged_users',
    'page_post_engagements',
  ]);
  const parts = [resolved.likes, resolved.comments, resolved.shares, resolved.saves]
    .filter((value) => value != null);
  const total = totalDirect ?? (parts.length ? parts.reduce((sum, value) => sum + value, 0) : null);
  const available = LIVE_STATUS.has(source.status) || source.data.length > 0;

  return { ...resolved, total, available };
}
