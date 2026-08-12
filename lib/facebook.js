import fs from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.ogv': 'video/ogg',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
};

const VIDEO_EXTENSIONS = new Set(['.avi', '.m4v', '.mov', '.mp4', '.mpeg', '.mpg', '.ogv', '.webm']);

export class FacebookPublishError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FacebookPublishError';
    this.code = details.code;
    this.subcode = details.subcode;
    this.status = details.status;
    this.traceId = details.traceId;
    this.retriable = Boolean(details.retriable);
  }
}

export function formatFacebookMessage(post) {
  const message = String(post.facebook || '').trim();
  const hashtags = Array.isArray(post.hashtags)
    ? [...new Set(post.hashtags.map((tag) => String(tag).trim()).filter(Boolean))]
    : [];
  const missingHashtags = hashtags.filter((tag) => !message.includes(tag));
  return [message, missingHashtags.join(' ')].filter(Boolean).join('\n\n');
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function parseGraphResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (response.ok && !payload.error) return payload;

  const graphError = payload.error || {};
  const retriable = Boolean(graphError.is_transient) || response.status === 429 || response.status >= 500;
  throw new FacebookPublishError(
    graphError.message || `Facebook Graph API 回傳 HTTP ${response.status}`,
    {
      code: graphError.code,
      subcode: graphError.error_subcode,
      status: response.status,
      traceId: graphError.fbtrace_id,
      retriable,
    },
  );
}

export function createFacebookPublisher({
  pageId,
  pageAccessToken,
  graphVersion = 'v25.0',
  graphBaseUrl = 'https://graph.facebook.com',
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
} = {}) {
  const configured = Boolean(pageId && pageAccessToken);

  function assertConfigured() {
    if (!configured) {
      throw new FacebookPublishError(
        'Facebook 尚未設定。請在 .env 填入 FACEBOOK_PAGE_ID 與 FACEBOOK_PAGE_ACCESS_TOKEN。',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new FacebookPublishError('目前的 Node.js 版本不支援 fetch，請使用 Node.js 18 或更新版本。');
    }
  }

  async function graphRequest(endpoint, options = {}) {
    assertConfigured();
    const timeout = createTimeoutSignal(timeoutMs);
    const { query, ...fetchOptions } = options;
    const url = new URL(
      `${graphBaseUrl.replace(/\/$/, '')}/${graphVersion}/${encodeURIComponent(pageId)}${endpoint ? `/${endpoint}` : ''}`,
    );
    Object.entries(query || {}).forEach(([key, value]) => url.searchParams.set(key, value));
    try {
      const response = await fetchImpl(
        url,
        {
          method: 'POST',
          ...fetchOptions,
          headers: {
            Authorization: `Bearer ${pageAccessToken}`,
            ...(fetchOptions.headers || {}),
          },
          signal: timeout.signal,
        },
      );
      return await parseGraphResponse(response);
    } catch (error) {
      if (error instanceof FacebookPublishError) throw error;
      const timedOut = error?.name === 'AbortError';
      throw new FacebookPublishError(
        timedOut ? 'Facebook 發布逾時，稍後會再試。' : `無法連線 Facebook：${error?.message || '未知錯誤'}`,
        { retriable: true },
      );
    } finally {
      timeout.cancel();
    }
  }

  async function mediaForm(filePath, textField, message) {
    const buffer = await fs.readFile(filePath).catch((error) => {
      throw new FacebookPublishError(`讀取發布媒體失敗：${error.message}`);
    });
    const extension = path.extname(filePath).toLowerCase();
    const form = new FormData();
    if (textField && message) form.append(textField, message);
    form.append('source', new Blob([buffer], { type: MIME_TYPES[extension] || 'application/octet-stream' }), path.basename(filePath));
    return form;
  }

  async function publish(post, { imageFilePath = '', mediaFilePaths = [] } = {}) {
    const message = formatFacebookMessage(post);
    if (!message) throw new FacebookPublishError('Facebook 文案不能是空白。');
    const filePaths = mediaFilePaths.length ? mediaFilePaths : (imageFilePath ? [imageFilePath] : []);
    const videoPaths = filePaths.filter((filePath) => VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase()));

    if (videoPaths.length) {
      if (filePaths.length !== 1) {
        throw new FacebookPublishError('Facebook 自動發布目前支援多張圖片，或單一影片；請勿混合圖片與影片。');
      }
      const form = await mediaForm(videoPaths[0], 'description', message);
      const payload = await graphRequest('videos', { body: form });
      return { externalId: payload.id, videoId: payload.id, type: 'video' };
    }

    if (filePaths.length === 1) {
      const form = await mediaForm(filePaths[0], 'caption', message);
      const payload = await graphRequest('photos', { body: form });
      return { externalId: payload.post_id || payload.id, photoId: payload.id, type: 'photo' };
    }

    if (filePaths.length > 1) {
      const photoIds = [];
      for (const filePath of filePaths) {
        const form = await mediaForm(filePath);
        form.append('published', 'false');
        const uploaded = await graphRequest('photos', { body: form });
        if (!uploaded.id) throw new FacebookPublishError('Facebook 未回傳照片 ID，無法建立多圖貼文。');
        photoIds.push(uploaded.id);
      }
      const body = new URLSearchParams({ message });
      photoIds.forEach((photoId, index) => body.append(`attached_media[${index}]`, JSON.stringify({ media_fbid: photoId })));
      const payload = await graphRequest('feed', {
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      return { externalId: payload.id, photoIds, type: 'multi-photo' };
    }

    const body = new URLSearchParams({ message });
    const payload = await graphRequest('feed', {
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return { externalId: payload.id, type: 'feed' };
  }

  async function verify() {
    const payload = await graphRequest('', { method: 'GET', query: { fields: 'id,name' } });
    return { id: payload.id, name: payload.name || '' };
  }

  return { configured, publish, verify };
}
