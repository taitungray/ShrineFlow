import { classifyPublishError } from './publish-reliability.js';
import { createRateLimitedFetch } from './platform-rate-limit.js';

const DEFAULT_METRICS = {
  facebook: ['page_post_engagements', 'page_views_total', 'page_follows'],
  instagram: ['views', 'likes', 'comments', 'shares', 'saves', 'profile_links_taps'],
  threads: ['views', 'likes', 'replies', 'reposts', 'quotes', 'clicks', 'followers_count'],
};

const DEFAULT_POST_METRICS = {
  facebook: ['post_impressions', 'post_engaged_users', 'post_clicks'],
  instagram: ['views', 'likes', 'comments', 'shares', 'saved'],
  threads: ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'],
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

function normalizeMetrics(platformId, metrics) {
  const fallback = DEFAULT_METRICS[platformId] || [];
  const selected = Array.isArray(metrics)
    ? metrics
    : String(metrics || '').split(',');
  const normalized = [...new Set(selected.map((metric) => String(metric).trim()).filter(Boolean))];
  return normalized.length ? normalized : fallback;
}

function normalizeRange({ since, until } = {}) {
  const end = until ? new Date(until) : new Date();
  const start = since ? new Date(since) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
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
    const targetPath = pathOverride || insightsPath;
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

  return {
    configured,
    platformId,
    async fetchAccountInsights({ since, until, metrics } = {}) {
      const range = normalizeRange({ since, until });
      const payload = await request(resourceId, insightsPath, {
        metric: normalizeMetrics(platformId, metrics || DEFAULT_METRICS[platformId]).join(','),
        period: 'day',
        since: Math.floor(range.since.getTime() / 1000),
        until: Math.floor(range.until.getTime() / 1000),
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
        data: Array.isArray(payload.data) ? payload.data : [],
        paging: payload.paging || null,
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
      const payload = await request(targetId, '/insights', {
        metric: normalizeMetrics(platformId, metrics || DEFAULT_POST_METRICS[platformId]).join(','),
      });
      return {
        platformId,
        scope: 'post',
        externalId: targetId,
        source: 'meta_graph_api',
        fetchedAt: new Date().toISOString(),
        data: Array.isArray(payload.data) ? payload.data : [],
        paging: payload.paging || null,
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
