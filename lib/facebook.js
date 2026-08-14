import fs from 'node:fs/promises';
import path from 'node:path';
import { createRateLimitedFetch } from './platform-rate-limit.js';

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
const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);

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

export function formatReelMessage(post) {
  const message = String(post.reel || post.facebook || '').trim();
  const hashtags = Array.isArray(post.hashtags)
    ? [...new Set(post.hashtags.map((tag) => String(tag).trim()).filter(Boolean))]
    : [];
  const missingHashtags = hashtags.filter((tag) => !message.includes(tag));
  return [message, missingHashtags.join(' ')].filter(Boolean).join('\n\n');
}

export function assertFacebookScheduleWindow(scheduledAt, now = new Date()) {
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) {
    throw new FacebookPublishError('排程時間格式不正確。');
  }
  const min = new Date(now.getTime() + 10 * 60 * 1000);
  const max = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
  if (when < min) {
    throw new FacebookPublishError('Facebook 排程時間須至少在 10 分鐘之後。');
  }
  if (when > max) {
    throw new FacebookPublishError('Facebook 排程時間不可超過約 6 個月。');
  }
  return when;
}

function buildScheduleParams(scheduledAt) {
  const when = assertFacebookScheduleWindow(scheduledAt);
  return {
    published: 'false',
    scheduled_publish_time: String(Math.floor(when.getTime() / 1000)),
  };
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

function collectMediaPaths({ imageFilePath = '', mediaFilePaths = [] } = {}) {
  return mediaFilePaths.length ? mediaFilePaths : (imageFilePath ? [imageFilePath] : []);
}

function splitMedia(filePaths = []) {
  const videos = filePaths.filter((filePath) => VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
  const images = filePaths.filter((filePath) => IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
  return { videos, images };
}

export function createFacebookPublisher({
  pageId,
  pageAccessToken,
  graphVersion = 'v25.0',
  graphBaseUrl = 'https://graph.facebook.com',
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
  uploadTimeoutMs = 180_000,
} = {}) {
  const configured = Boolean(pageId && pageAccessToken);
  const graphRoot = graphBaseUrl.replace(/\/$/, '');
  const rateLimitedFetch = createRateLimitedFetch(fetchImpl, {
    platformId: 'facebook',
    accountKey: pageId || 'default',
  });

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

  async function rawRequest(url, options = {}, requestTimeoutMs = timeoutMs) {
    assertConfigured();
    const timeout = createTimeoutSignal(requestTimeoutMs);
    try {
      const response = await rateLimitedFetch(url, {
        method: 'POST',
        ...options,
        headers: {
          Authorization: `Bearer ${pageAccessToken}`,
          ...(options.headers || {}),
        },
        signal: timeout.signal,
      });
      return await parseGraphResponse(response);
    } catch (error) {
      if (error instanceof FacebookPublishError) throw error;
      if (error?.code === 'PROVIDER_RATE_LIMIT_LOCAL') {
        throw new FacebookPublishError(error.message, { code: error.code, status: 429, retriable: true });
      }
      const timedOut = error?.name === 'AbortError';
      throw new FacebookPublishError(
        timedOut ? 'Facebook 發布逾時，稍後會再試。' : `無法連線 Facebook：${error?.message || '未知錯誤'}`,
        { retriable: true },
      );
    } finally {
      timeout.cancel();
    }
  }

  async function graphRequest(endpoint, options = {}) {
    const { query, timeoutMs: requestTimeoutMs, ...fetchOptions } = options;
    const url = new URL(
      `${graphRoot}/${graphVersion}/${encodeURIComponent(pageId)}${endpoint ? `/${endpoint}` : ''}`,
    );
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
    return rawRequest(url, fetchOptions, requestTimeoutMs);
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

  async function startResumableVideo(endpoint) {
    const body = new URLSearchParams({ upload_phase: 'start' });
    const payload = await graphRequest(endpoint, {
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!payload.video_id) {
      throw new FacebookPublishError(`Facebook 未回傳 video_id（${endpoint}）。`);
    }
    return {
      videoId: String(payload.video_id),
      uploadUrl: payload.upload_url
        || `${graphRoot.replace('graph.facebook.com', 'rupload.facebook.com')}/video-upload/${graphVersion}/${payload.video_id}`,
    };
  }

  async function uploadVideoBinary(uploadUrl, filePath) {
    const buffer = await fs.readFile(filePath).catch((error) => {
      throw new FacebookPublishError(`讀取發布媒體失敗：${error.message}`);
    });
    const payload = await rawRequest(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${pageAccessToken}`,
        offset: '0',
        file_size: String(buffer.byteLength),
        'Content-Type': 'application/octet-stream',
      },
      body: buffer,
    }, uploadTimeoutMs);
    if (payload.success === false) {
      throw new FacebookPublishError('Facebook 影片上傳失敗。');
    }
    return payload;
  }

  async function finishResumableVideo(endpoint, videoId, extra = {}) {
    const body = new URLSearchParams({
      upload_phase: 'finish',
      video_id: videoId,
      video_state: 'PUBLISHED',
      ...Object.fromEntries(
        Object.entries(extra).filter(([, value]) => value !== undefined && value !== null && value !== ''),
      ),
    });
    return graphRequest(endpoint, {
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeoutMs: uploadTimeoutMs,
    });
  }

  async function publishFeedPost(post, filePaths, options = {}) {
    const message = formatFacebookMessage(post);
    if (!message) throw new FacebookPublishError('Facebook 文案不能是空白。');
    const { videos: videoPaths } = splitMedia(filePaths);
    const scheduleParams = options.scheduledAt ? buildScheduleParams(options.scheduledAt) : null;

    if (videoPaths.length) {
      if (filePaths.length !== 1) {
        throw new FacebookPublishError('Facebook 貼文目前支援多張圖片，或單一影片；請勿混合圖片與影片。');
      }
      const form = await mediaForm(videoPaths[0], 'description', message);
      if (scheduleParams) {
        form.append('published', scheduleParams.published);
        form.append('scheduled_publish_time', scheduleParams.scheduled_publish_time);
      }
      const payload = await graphRequest('videos', { body: form, timeoutMs: uploadTimeoutMs });
      return { externalId: payload.id, videoId: payload.id, type: 'video' };
    }

    if (filePaths.length === 1) {
      const form = await mediaForm(filePaths[0], 'caption', message);
      if (scheduleParams) {
        form.append('published', scheduleParams.published);
        form.append('scheduled_publish_time', scheduleParams.scheduled_publish_time);
      }
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
      if (scheduleParams) {
        body.set('published', scheduleParams.published);
        body.set('scheduled_publish_time', scheduleParams.scheduled_publish_time);
      }
      photoIds.forEach((photoId, index) => body.append(`attached_media[${index}]`, JSON.stringify({ media_fbid: photoId })));
      const payload = await graphRequest('feed', {
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      return { externalId: payload.id, photoIds, type: 'multi-photo' };
    }

    const body = new URLSearchParams({ message });
    if (scheduleParams) {
      body.set('published', scheduleParams.published);
      body.set('scheduled_publish_time', scheduleParams.scheduled_publish_time);
    }
    const payload = await graphRequest('feed', {
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return { externalId: payload.id, type: 'feed' };
  }

  async function publishReel(post, filePaths, options = {}) {
    const { videos } = splitMedia(filePaths);
    if (videos.length !== 1 || filePaths.length !== 1) {
      throw new FacebookPublishError('Facebook Reel 需要恰好一支影片（建議直式 9:16、3–90 秒）。');
    }

    const description = formatReelMessage(post);
    const scheduleParams = options.scheduledAt ? buildScheduleParams(options.scheduledAt) : null;
    const { videoId, uploadUrl } = await startResumableVideo('video_reels');
    await uploadVideoBinary(uploadUrl, videos[0]);
    const finishExtra = { description: description || undefined };
    if (scheduleParams) {
      finishExtra.video_state = 'SCHEDULED';
      finishExtra.scheduled_publish_time = scheduleParams.scheduled_publish_time;
    }
    const finished = await finishResumableVideo('video_reels', videoId, finishExtra);
    return {
      externalId: finished.post_id || videoId,
      videoId,
      postId: finished.post_id || null,
      type: 'reel',
    };
  }

  async function publishPhotoStory(filePath) {
    const form = await mediaForm(filePath);
    form.append('published', 'false');
    const uploaded = await graphRequest('photos', { body: form });
    if (!uploaded.id) throw new FacebookPublishError('Facebook 未回傳照片 ID，無法發布限時動態。');

    const body = new URLSearchParams({ photo_id: uploaded.id });
    const payload = await graphRequest('photo_stories', {
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return {
      externalId: payload.post_id || uploaded.id,
      photoId: uploaded.id,
      postId: payload.post_id || null,
      type: 'photo-story',
    };
  }

  async function publishVideoStory(filePath) {
    const { videoId, uploadUrl } = await startResumableVideo('video_stories');
    await uploadVideoBinary(uploadUrl, filePath);
    const finished = await finishResumableVideo('video_stories', videoId);
    return {
      externalId: finished.post_id || videoId,
      videoId,
      postId: finished.post_id || null,
      type: 'video-story',
    };
  }

  async function publishStory(filePaths) {
    const { videos, images } = splitMedia(filePaths);
    if (filePaths.length !== 1 || (videos.length + images.length) !== 1) {
      throw new FacebookPublishError('Facebook 限時動態一次只能發一張圖片或一支影片。');
    }
    if (videos.length === 1) return publishVideoStory(videos[0]);
    return publishPhotoStory(images[0]);
  }

  async function publish(post, options = {}) {
    const contentType = String(options.contentType || post.contentType || 'post').trim() || 'post';
    const filePaths = collectMediaPaths(options);

    if (options.scheduledAt && contentType === 'story') {
      throw new FacebookPublishError('Facebook 限時動態不支援排程，請改用立刻發布。');
    }

    let result;
    if (contentType === 'reel') result = await publishReel(post, filePaths, options);
    else if (contentType === 'story') result = await publishStory(filePaths);
    else if (contentType !== 'post') {
      throw new FacebookPublishError(`尚未支援的 Facebook 發布格式：${contentType}`);
    } else {
      result = await publishFeedPost(post, filePaths, options);
    }
    if (options.scheduledAt && !result.externalId) {
      throw new FacebookPublishError('Facebook 未回傳排程 ID。');
    }
    return { ...result, scheduled: Boolean(options.scheduledAt) };
  }

  async function deleteScheduled(externalId) {
    const id = String(externalId || '').trim();
    if (!id) throw new FacebookPublishError('缺少要取消的 Facebook 排程 ID。');
    await rawRequest(`${graphRoot}/${graphVersion}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { deleted: true, externalId: id };
  }

  async function verify() {
    const payload = await graphRequest('', { method: 'GET', query: { fields: 'id,name' } });
    return { id: payload.id, name: payload.name || '' };
  }

  return { configured, publish, verify, deleteScheduled };
}
