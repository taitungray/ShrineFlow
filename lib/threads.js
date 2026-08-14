import path from 'node:path';
import { resolvePublicMediaUrls } from './media-public-url.js';
import { createRateLimitedFetch } from './platform-rate-limit.js';

const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.avi', '.m4v', '.mov', '.mp4', '.mpeg', '.mpg', '.ogv', '.webm']);
const CONTAINER_WAIT_MS = 1_000;

export class ThreadsPublishError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ThreadsPublishError';
    this.code = details.code;
    this.retriable = Boolean(details.retriable);
  }
}

const INVALID_PUBLIC_MEDIA_BASE_MESSAGE =
  'PUBLIC_MEDIA_BASE_URL 無效，請填寫可公開存取的完整網址（含 https://）。Invalid PUBLIC_MEDIA_BASE_URL — set a full public base URL.';

function assertValidPublicMediaUrl(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ThreadsPublishError(INVALID_PUBLIC_MEDIA_BASE_MESSAGE);
    }
  } catch (error) {
    if (error instanceof ThreadsPublishError) throw error;
    throw new ThreadsPublishError(INVALID_PUBLIC_MEDIA_BASE_MESSAGE);
  }
}

async function parseGraphResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (response.ok && !payload.error) return payload;

  const graphError = payload.error || {};
  throw new ThreadsPublishError(
    graphError.message || `Threads Graph API 回傳 HTTP ${response.status}`,
    {
      code: graphError.code,
      retriable: Boolean(graphError.is_transient) || response.status === 429 || response.status >= 500,
    },
  );
}

function formBody(values) {
  return new URLSearchParams(
    Object.entries(values)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, String(value)]),
  );
}

function mediaType(mediaUrl) {
  let pathname;
  try {
    pathname = new URL(mediaUrl).pathname;
  } catch {
    throw new ThreadsPublishError(INVALID_PUBLIC_MEDIA_BASE_MESSAGE);
  }
  const extension = path.extname(pathname).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return 'IMAGE';
  if (VIDEO_EXTENSIONS.has(extension)) return 'VIDEO';
  return '';
}

export function createThreadsPublisher({
  userId,
  accessToken,
  graphVersion = 'v1.0',
  graphBaseUrl = 'https://graph.threads.net',
  fetchImpl = globalThis.fetch,
  publicMediaBaseUrl = process.env.PUBLIC_MEDIA_BASE_URL,
  sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const configured = Boolean(userId && accessToken);
  const graphRoot = graphBaseUrl.replace(/\/$/, '');
  const rateLimitedFetch = createRateLimitedFetch(fetchImpl, {
    platformId: 'threads',
    accountKey: userId || 'default',
  });

  function assertConfigured() {
    if (!configured) {
      throw new ThreadsPublishError(
        'Threads 尚未設定。請填入 Threads 使用者 ID 與存取權杖。',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new ThreadsPublishError('目前的 Node.js 版本不支援 fetch，請使用 Node.js 18 或更新版本。');
    }
  }

  function graphUrl(resource, query = {}) {
    const encodedResource = String(resource).split('/').map(encodeURIComponent).join('/');
    const url = new URL(`${graphRoot}/${graphVersion}/${encodedResource}`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
    return url;
  }

  async function graphRequest(resource, options = {}) {
    assertConfigured();
    const { query, ...fetchOptions } = options;
    try {
      const response = await rateLimitedFetch(graphUrl(resource, query), {
        method: 'POST',
        ...fetchOptions,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(fetchOptions.headers || {}),
        },
      });
      return await parseGraphResponse(response);
    } catch (error) {
      if (error instanceof ThreadsPublishError) throw error;
      if (error?.code === 'PROVIDER_RATE_LIMIT_LOCAL') {
        throw new ThreadsPublishError(error.message, { code: error.code, retriable: true });
      }
      throw new ThreadsPublishError(
        `無法連線 Threads：${error?.message || '未知錯誤'}`,
        { retriable: true },
      );
    }
  }

  function resolveMedia(mediaWebPaths) {
    try {
      const base = String(publicMediaBaseUrl || '').trim();
      if (base) assertValidPublicMediaUrl(base);
      const urls = resolvePublicMediaUrls(mediaWebPaths, publicMediaBaseUrl);
      urls.forEach(assertValidPublicMediaUrl);
      return urls;
    } catch (error) {
      if (error instanceof ThreadsPublishError) throw error;
      throw new ThreadsPublishError(error.message);
    }
  }

  async function publish(post = {}, options = {}) {
    assertConfigured();
    const mediaWebPaths = Array.isArray(options.mediaWebPaths) ? options.mediaWebPaths : [];
    if (mediaWebPaths.length > 1) {
      throw new ThreadsPublishError('Threads 貼文目前僅支援單一圖片或影片。');
    }

    const text = String(post.facebook || '').trim();
    const values = { media_type: 'TEXT', text };
    if (mediaWebPaths.length === 1) {
      const [mediaUrl] = resolveMedia(mediaWebPaths);
      const type = mediaType(mediaUrl);
      if (!type) throw new ThreadsPublishError('Threads 不支援此媒體格式。');
      values.media_type = type;
      values[type === 'VIDEO' ? 'video_url' : 'image_url'] = mediaUrl;
    }

    const container = await graphRequest(`${userId}/threads`, {
      body: formBody(values),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!container.id) {
      throw new ThreadsPublishError('Threads 未回傳媒體容器 ID。');
    }

    await sleepImpl(CONTAINER_WAIT_MS);
    const published = await graphRequest(`${userId}/threads_publish`, {
      body: formBody({ creation_id: container.id }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!published.id) {
      throw new ThreadsPublishError('Threads 未回傳發布貼文 ID。');
    }
    return { externalId: String(published.id), scheduled: false };
  }

  async function verify() {
    const payload = await graphRequest(userId, {
      method: 'GET',
      query: { fields: 'id,username' },
    });
    return {
      id: payload.id,
      ...(payload.username ? { username: payload.username } : {}),
    };
  }

  return { configured, publish, verify };
}
