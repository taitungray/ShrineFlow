import { classifyPublishError } from './publish-reliability.js';
import { createRateLimitedFetch } from './platform-rate-limit.js';

// Decision 2026-08-19:
// - Request every organic Graph Insights metric still documented for v25.
// - Skip ads/monetization, demographics objects, and unique-reach names deprecated above v25.
// - One invalid name must not fail the whole sync; drop it and keep the rest.
// - Facebook posts also read likes/comments/shares/reactions from the post object.

const METRIC_BATCH_SIZE = 8;

export const DEFAULT_METRICS = {
  facebook: [
    'page_post_engagements',
    'page_views_total',
    'page_follows',
    'page_daily_follows',
    'page_daily_follows_unique',
    'page_daily_unfollows_unique',
    'page_impressions',
    'page_impressions_paid',
    'page_impressions_viral',
    'page_impressions_nonviral',
    'page_media_view',
    'page_total_media_view_unique',
    'page_posts_impressions',
    'page_posts_impressions_unique',
    'page_posts_impressions_organic_unique',
    'page_total_actions',
    'page_actions_post_reactions_like_total',
    'page_actions_post_reactions_love_total',
    'page_actions_post_reactions_wow_total',
    'page_actions_post_reactions_haha_total',
    'page_actions_post_reactions_sorry_total',
    'page_actions_post_reactions_anger_total',
    'page_video_views',
    'page_video_views_organic',
    'page_video_complete_views_30s',
    'page_fans',
    'page_fan_adds',
    'page_fan_removes',
  ],
  instagram: [
    'views',
    'reach',
    'likes',
    'comments',
    'shares',
    'saves',
    'replies',
    'profile_links_taps',
    'accounts_engaged',
    'total_interactions',
    'follower_count',
    'follows_and_unfollows',
    'website_clicks',
    'profile_views',
  ],
  threads: ['views', 'likes', 'replies', 'reposts', 'quotes', 'clicks', 'followers_count', 'shares'],
};

export const DEFAULT_POST_METRICS = {
  facebook: [
    'post_media_view',
    'post_total_media_view_unique',
    'post_clicks',
    'post_engaged_users',
    'post_impressions',
    'post_impressions_organic',
    'post_impressions_paid',
    'post_impressions_fan',
    'post_impressions_viral',
    'post_impressions_nonviral',
    'post_reactions_like_total',
    'post_reactions_love_total',
    'post_reactions_wow_total',
    'post_reactions_haha_total',
    'post_reactions_sorry_total',
    'post_reactions_anger_total',
    'post_activity_by_action_type',
    'post_video_views',
    'post_video_views_organic',
    'post_video_complete_views_organic',
  ],
  instagram: [
    'views',
    'reach',
    'likes',
    'comments',
    'shares',
    'saved',
    'total_interactions',
    'follows',
    'profile_visits',
    'navigation',
  ],
  threads: ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares', 'clicks'],
};

export class InsightsApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InsightsApiError';
    this.platformId = details.platformId;
    this.status = details.status;
    this.code = details.code;
    this.subcode = details.subcode;
    this.traceId = details.traceId;
    this.retriable = Boolean(details.retriable);
    this.category = details.category || classifyPublishError(this);
  }
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function normalizeMetrics(platformId, metrics, fallbackCatalog = DEFAULT_METRICS) {
  const fallback = fallbackCatalog[platformId] || [];
  const selected = Array.isArray(metrics)
    ? metrics
    : String(metrics || '').split(',');
  const normalized = [...new Set(selected.map((metric) => String(metric).trim()).filter(Boolean))];
  return normalized.length ? normalized : fallback;
}

function parseDateOrSeconds(value, fallback = null) {
  if (value == null || value === '') return fallback ? new Date(fallback) : new Date();
  if (value instanceof Date) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed) : (fallback ? new Date(fallback) : new Date(Number.NaN));
}

function normalizeRange({ since, until } = {}) {
  const end = until ? parseDateOrSeconds(until) : new Date();
  const start = since ? parseDateOrSeconds(since) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new InsightsApiError('Insights 查詢時間範圍不正確。', { status: 400, category: 'validation' });
  }
  if (end.getTime() - start.getTime() > 90 * 24 * 60 * 60 * 1000) {
    throw new InsightsApiError('Insights 一次最多查詢 90 天。', { status: 400, category: 'validation' });
  }
  return { since: start, until: end };
}

function graphErrorFromPayload(platformId, response, payload) {
  const graphError = payload?.error || {};
  return new InsightsApiError(
    graphError.message || `${platformId} Insights API 回傳 HTTP ${response.status}`,
    {
      platformId,
      status: response.status,
      code: graphError.code,
      subcode: graphError.error_subcode,
      traceId: graphError.fbtrace_id,
      retriable: Boolean(graphError.is_transient) || response.status === 408 || response.status === 429 || response.status >= 500,
    },
  );
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function isNodeInsightsUnsupported(error) {
  const message = String(error?.message || '');
  return Number(error?.code) === 100 && /nonexisting field \(insights\)|node type/i.test(message);
}

function isInvalidMetricError(error) {
  if (isNodeInsightsUnsupported(error)) return false;
  const message = String(error?.message || '');
  return Number(error?.code) === 100
    || /valid insights metric|invalid metric|must be one of the following/i.test(message);
}

function engagementFieldsFromPost(payload = {}) {
  const likes = payload.likes?.summary?.total_count ?? payload.likes?.count;
  const comments = payload.comments?.summary?.total_count ?? payload.comments?.count;
  const shares = payload.shares?.count ?? payload.shares?.summary?.total_count;
  const reactions = payload.reactions?.summary?.total_count ?? payload.reactions?.count;
  return [
    ['likes', likes],
    ['comments', comments],
    ['shares', shares],
    ['reactions', reactions],
  ].filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => ({ name, value }));
}

function createGraphInsightsClient({
  platformId,
  resourceId,
  accessToken,
  graphVersion,
  graphBaseUrl,
  insightsPath,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
} = {}) {
  const configured = Boolean(resourceId && accessToken);
  const graphRoot = String(graphBaseUrl || '').replace(/\/$/, '');
  const rateLimitedFetch = createRateLimitedFetch(fetchImpl, {
    platformId,
    accountKey: resourceId || 'default',
  });

  async function request(resourceIdOverride, pathOverride, query) {
    if (!configured) {
      throw new InsightsApiError(`${platformId} 尚未設定 Insights 憑證。`, {
        platformId,
        status: 503,
        category: 'authentication',
      });
    }
    if (typeof fetchImpl !== 'function') {
      throw new InsightsApiError('目前的 Node.js 版本不支援 fetch。', {
        platformId,
        status: 500,
      });
    }

    const targetResourceId = resourceIdOverride || resourceId;
    const targetPath = pathOverride === undefined || pathOverride === null ? insightsPath : pathOverride;
    const url = new URL(`${graphRoot}/${graphVersion}/${encodeURIComponent(targetResourceId)}${targetPath}`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });
    const timeout = createTimeoutSignal(timeoutMs);
    try {
      const response = await rateLimitedFetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: timeout.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) throw graphErrorFromPayload(platformId, response, payload);
      return payload;
    } catch (error) {
      if (error instanceof InsightsApiError) throw error;
      if (error?.code === 'PROVIDER_RATE_LIMIT_LOCAL') {
        throw new InsightsApiError(error.message, {
          platformId,
          status: 429,
          code: error.code,
          retriable: true,
        });
      }
      throw new InsightsApiError(
        error?.name === 'AbortError'
          ? `${platformId} Insights 查詢逾時。`
          : `無法連線 ${platformId} Insights：${error?.message || '未知錯誤'}`,
        { platformId, retriable: true },
      );
    } finally {
      timeout.cancel();
    }
  }

  async function fetchMetricCatalog({
    metrics,
    query = {},
    resourceIdOverride,
    pathOverride,
  } = {}) {
    const data = [];
    const skippedMetrics = [];
    let paging = null;

    async function requestBatch(batch, extraQuery = {}) {
      return request(resourceIdOverride, pathOverride, {
        metric: batch.join(','),
        ...query,
        ...extraQuery,
      });
    }

    async function requestOne(metric, extraQuery = {}) {
      try {
        const payload = await requestBatch([metric], extraQuery);
        data.push(...(Array.isArray(payload.data) ? payload.data : []));
        if (payload.paging) paging = payload.paging;
        return true;
      } catch (error) {
        if (!isInvalidMetricError(error)) throw error;
        if (platformId === 'instagram' && extraQuery.metric_type !== 'total_value') {
          return requestOne(metric, { metric_type: 'total_value' });
        }
        skippedMetrics.push(metric);
        return false;
      }
    }

    for (const batch of chunk(metrics, METRIC_BATCH_SIZE)) {
      try {
        const payload = await requestBatch(batch);
        data.push(...(Array.isArray(payload.data) ? payload.data : []));
        if (payload.paging) paging = payload.paging;
      } catch (error) {
        if (isNodeInsightsUnsupported(error)) {
          skippedMetrics.push(...metrics);
          break;
        }
        if (!isInvalidMetricError(error)) throw error;
        for (const metric of batch) {
          await requestOne(metric);
        }
      }
    }

    return { data, skippedMetrics, paging };
  }

  return {
    configured,
    platformId,
    async fetchAccountInsights({ since, until, metrics } = {}) {
      const range = normalizeRange({ since, until });
      const selected = normalizeMetrics(platformId, metrics, DEFAULT_METRICS);
      const payload = await fetchMetricCatalog({
        metrics: selected,
        query: {
          period: 'day',
          since: Math.floor(range.since.getTime() / 1000),
          until: Math.floor(range.until.getTime() / 1000),
        },
      });
      return {
        platformId,
        scope: 'account',
        source: 'meta_graph_api',
        fetchedAt: new Date().toISOString(),
        range: {
          since: range.since.toISOString(),
          until: range.until.toISOString(),
        },
        data: payload.data,
        skippedMetrics: payload.skippedMetrics,
        paging: payload.paging,
      };
    },
    async fetchPostInsights({ externalId, metrics } = {}) {
      const targetId = String(externalId || '').trim();
      if (!targetId) {
        throw new InsightsApiError(`${platformId} 缺少平台貼文 ID，無法查詢貼文成效。`, {
          platformId,
          status: 400,
          category: 'validation',
        });
      }

      let engagement = [];
      if (platformId === 'facebook') {
        try {
          const postPayload = await request(targetId, '', {
            fields: 'shares,likes.summary(true),comments.summary(true),reactions.summary(true)',
          });
          engagement = engagementFieldsFromPost(postPayload);
        } catch (postErr) {
          if (postErr?.code === 4 || postErr?.code === 17 || postErr?.status === 429) {
            throw postErr;
          }
        }
      } else if (platformId === 'instagram') {
        try {
          const mediaObj = await request(targetId, '', {
            fields: 'like_count,comments_count',
          });
          if (mediaObj.like_count !== undefined && mediaObj.like_count !== null) {
            engagement.push({ name: 'likes', value: Number(mediaObj.like_count) });
          }
          if (mediaObj.comments_count !== undefined && mediaObj.comments_count !== null) {
            engagement.push({ name: 'comments', value: Number(mediaObj.comments_count) });
          }
        } catch (igErr) {
          if (igErr?.code === 4 || igErr?.code === 17 || igErr?.status === 429) {
            throw igErr;
          }
        }
      }

      let catalogData = [];
      let catalogSkipped = [];
      let catalogPaging = null;
      let catalogError = null;

      if (metrics || platformId !== 'facebook') {
        const selected = normalizeMetrics(platformId, metrics, DEFAULT_POST_METRICS);
        try {
          const payload = await fetchMetricCatalog({
            resourceIdOverride: targetId,
            pathOverride: '/insights',
            metrics: selected,
          });
          catalogData = Array.isArray(payload.data) ? payload.data : [];
          catalogSkipped = payload.skippedMetrics || [];
          catalogPaging = payload.paging || null;
        } catch (error) {
          catalogError = error;
        }
      }

      const combinedData = [...catalogData, ...engagement];
      if (!combinedData.length && catalogError) {
        throw catalogError;
      }

      return {
        platformId,
        scope: 'post',
        externalId: targetId,
        source: 'meta_graph_api',
        fetchedAt: new Date().toISOString(),
        data: combinedData,
        skippedMetrics: catalogSkipped,
        paging: catalogPaging,
      };
    },
  };
}

export function createFacebookInsightsClient(options = {}) {
  return createGraphInsightsClient({
    ...options,
    platformId: 'facebook',
    resourceId: options.pageId,
    accessToken: options.pageAccessToken,
    graphVersion: options.graphVersion || 'v25.0',
    graphBaseUrl: options.graphBaseUrl || 'https://graph.facebook.com',
    insightsPath: '/insights',
  });
}

export function createInstagramInsightsClient(options = {}) {
  return createGraphInsightsClient({
    ...options,
    platformId: 'instagram',
    resourceId: options.userId,
    accessToken: options.accessToken,
    graphVersion: options.graphVersion || 'v25.0',
    graphBaseUrl: options.graphBaseUrl || 'https://graph.facebook.com',
    insightsPath: '/insights',
  });
}

export function createThreadsInsightsClient(options = {}) {
  return createGraphInsightsClient({
    ...options,
    platformId: 'threads',
    resourceId: options.userId,
    accessToken: options.accessToken,
    graphVersion: options.graphVersion || 'v1.0',
    graphBaseUrl: options.graphBaseUrl || 'https://graph.threads.net',
    insightsPath: '/threads_insights',
  });
}
