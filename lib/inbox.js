import { classifyPublishError } from './publish-reliability.js';

const DEFAULT_FIELDS = {
  facebook: 'id,updated_time,participants,snippet,message_count',
  instagram: 'id,updated_time,participants,snippet,message_count',
  threads: 'id,text,timestamp,username,permalink,has_replies,is_reply',
};

export class InboxApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InboxApiError';
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

function normalizeItem(platformId, item, type = 'conversation') {
  return {
    id: String(item.id || ''),
    platformId,
    type,
    text: String(item.message || item.text || item.snippet || '').trim(),
    createdAt: item.created_time || item.timestamp || item.updated_time || null,
    updatedAt: item.updated_time || item.timestamp || null,
    author: item.from?.name || item.username || item.sender?.name || '',
    permalink: item.permalink || item.link || '',
    unread: Boolean(item.unread || item.is_unread),
    replyCount: Number(item.message_count || item.replies?.data?.length || 0),
  };
}

function createGraphInboxClient({
  platformId,
  resourceId,
  accessToken,
  graphVersion,
  graphBaseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
} = {}) {
  const configured = Boolean(resourceId && accessToken);
  const graphRoot = String(graphBaseUrl || '').replace(/\/$/, '');

  async function request(resource, query = {}) {
    if (!configured) {
      throw new InboxApiError(`${platformId} 尚未設定 Inbox 憑證。`, {
        platformId,
        status: 503,
        category: 'authentication',
      });
    }
    if (typeof fetchImpl !== 'function') {
      throw new InboxApiError('目前的 Node.js 版本不支援 fetch。', { platformId, status: 500 });
    }

    const encodedResource = String(resource).split('/').map(encodeURIComponent).join('/');
    const url = new URL(`${graphRoot}/${graphVersion}/${encodedResource}`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    const timeout = createTimeoutSignal(timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: timeout.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        const graphError = payload.error || {};
        throw new InboxApiError(
          graphError.message || `${platformId} Inbox API 回傳 HTTP ${response.status}`,
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
      return payload;
    } catch (error) {
      if (error instanceof InboxApiError) throw error;
      throw new InboxApiError(
        error?.name === 'AbortError'
          ? `${platformId} Inbox 查詢逾時。`
          : `無法連線 ${platformId} Inbox：${error?.message || '未知錯誤'}`,
        { platformId, retriable: true },
      );
    } finally {
      timeout.cancel();
    }
  }

  return { configured, platformId, request };
}

function createConversationClient(options = {}) {
  const client = createGraphInboxClient(options);
  return {
    ...client,
    async fetchRecent({ limit = 25, after = '' } = {}) {
      const payload = await client.request(`${options.resourceId}/conversations`, {
        fields: options.fields || DEFAULT_FIELDS[options.platformId],
        limit: Math.min(50, Math.max(1, Number(limit) || 25)),
        after,
      });
      return {
        platformId: options.platformId,
        source: 'meta_graph_api',
        fetchedAt: new Date().toISOString(),
        items: (payload.data || []).map((item) => normalizeItem(options.platformId, item)),
        paging: payload.paging || null,
      };
    },
  };
}

export function createFacebookInboxClient(options = {}) {
  return createConversationClient({
    ...options,
    platformId: 'facebook',
    resourceId: options.pageId,
    accessToken: options.pageAccessToken,
    graphVersion: options.graphVersion || 'v25.0',
    graphBaseUrl: options.graphBaseUrl || 'https://graph.facebook.com',
  });
}

export function createInstagramInboxClient(options = {}) {
  return createConversationClient({
    ...options,
    platformId: 'instagram',
    resourceId: options.userId,
    accessToken: options.accessToken,
    graphVersion: options.graphVersion || 'v25.0',
    graphBaseUrl: options.graphBaseUrl || 'https://graph.facebook.com',
  });
}

export function createThreadsInboxClient(options = {}) {
  const client = createGraphInboxClient({
    ...options,
    platformId: 'threads',
    resourceId: options.userId,
    accessToken: options.accessToken,
    graphVersion: options.graphVersion || 'v1.0',
    graphBaseUrl: options.graphBaseUrl || 'https://graph.threads.net',
  });

  return {
    ...client,
    async fetchRecent({ limit = 25 } = {}) {
      const threadPayload = await client.request(`${options.userId}/threads`, {
        fields: options.fields || DEFAULT_FIELDS.threads,
        limit: Math.min(25, Math.max(1, Number(limit) || 25)),
      });
      const items = [];
      for (const thread of threadPayload.data || []) {
        const conversation = await client.request(`${thread.id}/conversation`, {
          fields: options.fields || DEFAULT_FIELDS.threads,
          limit: 10,
          reverse: true,
        });
        const replies = (conversation.data || []).map((item) => normalizeItem('threads', item, 'reply'));
        if (replies.length) items.push(...replies);
        else items.push(normalizeItem('threads', thread, 'thread'));
      }
      return {
        platformId: 'threads',
        source: 'meta_graph_api',
        fetchedAt: new Date().toISOString(),
        items,
        paging: threadPayload.paging || null,
      };
    },
  };
}
