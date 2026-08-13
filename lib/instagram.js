import path from 'node:path';
import { resolvePublicMediaUrls } from './media-public-url.js';

const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.avi', '.m4v', '.mov', '.mp4', '.mpeg', '.mpg', '.ogv', '.webm']);
const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2_000;

export class InstagramPublishError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InstagramPublishError';
    this.code = details.code;
    this.retriable = Boolean(details.retriable);
  }
}

async function parseGraphResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (response.ok && !payload.error) return payload;

  const graphError = payload.error || {};
  throw new InstagramPublishError(
    graphError.message || `Instagram Graph API 回傳 HTTP ${response.status}`,
    {
      code: graphError.code,
      retriable: Boolean(graphError.is_transient) || response.status === 429 || response.status >= 500,
    },
  );
}

function mediaKind(mediaUrl) {
  const extension = path.extname(new URL(mediaUrl).pathname).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return '';
}

function formBody(values) {
  return new URLSearchParams(
    Object.entries(values)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, String(value)]),
  );
}

export function createInstagramPublisher({
  userId,
  accessToken,
  graphVersion = process.env.META_GRAPH_VERSION || 'v25.0',
  graphBaseUrl = 'https://graph.facebook.com',
  fetchImpl = globalThis.fetch,
  publicMediaBaseUrl = process.env.PUBLIC_MEDIA_BASE_URL,
  sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const configured = Boolean(userId && accessToken);
  const graphRoot = graphBaseUrl.replace(/\/$/, '');

  function assertConfigured() {
    if (!configured) {
      throw new InstagramPublishError(
        'Instagram 尚未設定。請填入 Instagram 使用者 ID 與存取權杖。',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new InstagramPublishError('目前的 Node.js 版本不支援 fetch，請使用 Node.js 18 或更新版本。');
    }
  }

  function graphUrl(resource, query = {}) {
    const url = new URL(
      `${graphRoot}/${graphVersion}/${String(resource).split('/').map(encodeURIComponent).join('/')}`,
    );
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
    return url;
  }

  async function graphRequest(resource, options = {}) {
    assertConfigured();
    const { query, ...fetchOptions } = options;
    try {
      const response = await fetchImpl(graphUrl(resource, query), {
        method: 'POST',
        ...fetchOptions,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(fetchOptions.headers || {}),
        },
      });
      return await parseGraphResponse(response);
    } catch (error) {
      if (error instanceof InstagramPublishError) throw error;
      throw new InstagramPublishError(
        `無法連線 Instagram：${error?.message || '未知錯誤'}`,
        { retriable: true },
      );
    }
  }

  async function createContainer(values) {
    const payload = await graphRequest(`${userId}/media`, {
      body: formBody(values),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!payload.id) {
      throw new InstagramPublishError('Instagram 未回傳媒體容器 ID。');
    }
    return String(payload.id);
  }

  async function waitForContainer(creationId) {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      const payload = await graphRequest(creationId, {
        method: 'GET',
        query: { fields: 'status_code' },
      });
      const status = String(payload.status_code || '').toUpperCase();
      if (status === 'FINISHED') return;
      if (status === 'ERROR') {
        throw new InstagramPublishError('Instagram 媒體容器處理失敗。');
      }
      if (attempt < POLL_ATTEMPTS - 1) await sleepImpl(POLL_INTERVAL_MS);
    }
    throw new InstagramPublishError('Instagram 媒體容器處理逾時，請稍後再試。', {
      retriable: true,
    });
  }

  async function publishContainer(creationId) {
    await waitForContainer(creationId);
    const payload = await graphRequest(`${userId}/media_publish`, {
      body: formBody({ creation_id: creationId }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!payload.id) {
      throw new InstagramPublishError('Instagram 未回傳發布媒體 ID。');
    }
    return { externalId: String(payload.id), scheduled: false };
  }

  function resolveMedia(mediaWebPaths) {
    try {
      return resolvePublicMediaUrls(mediaWebPaths, publicMediaBaseUrl);
    } catch (error) {
      throw new InstagramPublishError(error.message);
    }
  }

  async function publishFeed(post, mediaUrls) {
    const caption = String(post?.facebook || '').trim();
    const kinds = mediaUrls.map(mediaKind);

    if (mediaUrls.length === 1) {
      if (!kinds[0]) throw new InstagramPublishError('Instagram 不支援此媒體格式。');
      const values = kinds[0] === 'video'
        ? { media_type: 'VIDEO', video_url: mediaUrls[0], caption }
        : { image_url: mediaUrls[0], caption };
      return publishContainer(await createContainer(values));
    }

    if (kinds.some((kind) => kind !== 'image')) {
      throw new InstagramPublishError('Instagram 多圖貼文僅支援圖片。');
    }
    const children = [];
    for (const imageUrl of mediaUrls) {
      children.push(await createContainer({ image_url: imageUrl, is_carousel_item: true }));
    }
    const creationId = await createContainer({
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption,
    });
    return publishContainer(creationId);
  }

  async function publishReel(post, mediaUrls) {
    if (mediaUrls.length !== 1 || mediaKind(mediaUrls[0]) !== 'video') {
      throw new InstagramPublishError('Instagram Reel 需要恰好一支影片。');
    }
    const creationId = await createContainer({
      media_type: 'REELS',
      video_url: mediaUrls[0],
      caption: String(post?.reel || '').trim(),
    });
    return publishContainer(creationId);
  }

  async function publishStory(post, mediaUrls) {
    if (mediaUrls.length !== 1) {
      throw new InstagramPublishError('Instagram 限時動態需要恰好一個媒體。');
    }
    const kind = mediaKind(mediaUrls[0]);
    if (!kind) throw new InstagramPublishError('Instagram 不支援此媒體格式。');
    const creationId = await createContainer({
      media_type: 'STORIES',
      [kind === 'video' ? 'video_url' : 'image_url']: mediaUrls[0],
    });
    return publishContainer(creationId);
  }

  async function publish(post = {}, options = {}) {
    assertConfigured();
    const contentType = String(options.contentType || 'feed').trim() || 'feed';
    const mediaWebPaths = Array.isArray(options.mediaWebPaths) ? options.mediaWebPaths : [];
    if (!mediaWebPaths.length) {
      throw new InstagramPublishError('Instagram 發布需要至少一個媒體。');
    }
    if (contentType === 'story' && mediaWebPaths.length !== 1) {
      throw new InstagramPublishError('Instagram 限時動態需要恰好一個媒體。');
    }
    const mediaUrls = resolveMedia(mediaWebPaths);

    if (contentType === 'feed') return publishFeed(post, mediaUrls);
    if (contentType === 'reel') return publishReel(post, mediaUrls);
    if (contentType === 'story') return publishStory(post, mediaUrls);
    throw new InstagramPublishError(`尚未支援的 Instagram 發布格式：${contentType}`);
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
