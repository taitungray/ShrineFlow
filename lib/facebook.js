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
    unpublished_content_type: 'SCHEDULED',
  };
}

function applyScheduleParams(body, scheduleParams) {
  if (!scheduleParams || !body) return;
  const set = typeof body.set === 'function' ? body.set.bind(body) : body.append.bind(body);
  set('published', scheduleParams.published);
  set('scheduled_publish_time', scheduleParams.scheduled_publish_time);
  set('unpublished_content_type', scheduleParams.unpublished_content_type);
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
    humanizeFacebookGraphError(graphError, `Facebook Graph API 回傳 HTTP ${response.status}`),
    {
      code: graphError.code,
      subcode: graphError.error_subcode,
      status: response.status,
      traceId: graphError.fbtrace_id,
      retriable,
    },
  );
}

const FACEBOOK_OBJECT_ACCESS_MESSAGE = 'Facebook 無法對這個 ID 發文。通常是貼了個人 User ID 或 User token，不是粉專 ID／Page token。請到設定用 Graph Explorer GET me/accounts，貼左邊 JSON 的 id 與 access_token。';
const FACEBOOK_USER_TOKEN_MESSAGE = 'Facebook Token 是用戶權杖，不是粉專 Page token。測連線讀粉專會過，發文仍會失敗。請用 Graph Explorer GET me/accounts 左邊 JSON 該粉專的 access_token 覆寫。';
const FACEBOOK_PAGE_OPERATION_MESSAGE = 'Facebook 無法完成這個發文操作。粉專 ID 與 Token 對得上，但權限不足或此格式（Reel／限時）粉專不支援。請確認 App 有 pages_manage_posts，Debugger 的 Type 應為 Page。';

function isFacebookMissingObjectMessage(message, code, subcode) {
  if (Number(code) === 100 && Number(subcode) === 33) return true;
  return /unsupported post request|does not exist, cannot be loaded due to missing permissions|does not support this operation|無法對這個 ID 發文/i.test(String(message || ''));
}

export function isFacebookObjectAccessError(error) {
  return isFacebookMissingObjectMessage(error?.message, error?.code, error?.subcode);
}

export function isFacebookScheduledPostGone(error) {
  if (Number(error?.code) === 190) return false;
  if (Number(error?.code) === 100 && Number(error?.subcode) === 33) return true;
  return /does not exist|unsupported delete request/i.test(String(error?.message || ''));
}

export function humanizeFacebookGraphError(graphError = {}, fallback = '') {
  const message = String(graphError.message || fallback || '');
  const code = Number(graphError.code);
  const subcode = graphError.error_subcode || graphError.subcode;
  if (code === 190 || /session has expired|expired access token|error validating access token|invalid oauth/i.test(message)) {
    return 'Facebook Token 已過期。請到設定貼上粉專 Page token（Graph Explorer → me/accounts 左邊 JSON 的 access_token；Access Token Debugger 應顯示 Expires: Never）。不要用短效 User token。';
  }
  if (code === 200 || /permissions error|#200/i.test(message)) {
    return 'Facebook 權限不足。請在 App 使用案例新增 pages_show_list、pages_read_engagement、pages_manage_posts。';
  }
  if (isFacebookMissingObjectMessage(message, code, subcode)) {
    return FACEBOOK_OBJECT_ACCESS_MESSAGE;
  }
  return message || 'Facebook 請求失敗。';
}

function collectMediaPaths({ imageFilePath = '', mediaFilePaths = [] } = {}) {
  return mediaFilePaths.length ? mediaFilePaths : (imageFilePath ? [imageFilePath] : []);
}

function mediaBufferFor(filePath, mediaBuffers = []) {
  return (Array.isArray(mediaBuffers) ? mediaBuffers : []).find((entry) => (
    entry?.path === filePath || entry?.name === path.basename(filePath)
  )) || null;
}

function collectMediaPathsWithBuffers({ imageFilePath = '', mediaFilePaths = [], mediaBuffers = [] } = {}) {
  if (mediaFilePaths.length) return mediaFilePaths;
  if (Array.isArray(mediaBuffers) && mediaBuffers.length) {
    return mediaBuffers.map((entry) => entry.path || entry.name).filter(Boolean);
  }
  return imageFilePath ? [imageFilePath] : [];
}

async function mediaFormForPath(filePath, textField, message, mediaBuffers = []) {
  const entry = mediaBufferFor(filePath, mediaBuffers);
  let buffer = entry?.buffer;
  if (!buffer) {
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      throw new FacebookPublishError('Facebook media file is unavailable.');
    }
  }
  const form = new FormData();
  if (textField && message) form.append(textField, message);
  form.append(
    'source',
    new Blob([buffer], { type: entry?.mimeType || MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream' }),
    entry?.name || path.basename(filePath),
  );
  return form;
}

async function uploadVideoBuffer(uploadUrl, filePath, mediaBuffers = [], {
  rawRequest,
  pageAccessToken,
  uploadTimeoutMs,
} = {}) {
  const entry = mediaBufferFor(filePath, mediaBuffers);
  if (!entry?.buffer || typeof rawRequest !== 'function') return null;
  const payload = await rawRequest(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: 'OAuth ' + pageAccessToken,
      offset: '0',
      file_size: String(entry.buffer.byteLength),
      'Content-Type': 'application/octet-stream',
    },
    body: entry.buffer,
  }, uploadTimeoutMs);
  if (payload.success === false) throw new FacebookPublishError('Facebook video upload failed.');
  return payload;
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
  let activePageId = pageId;
  let activePageAccessToken = pageAccessToken;
  let recoveredSession = false;
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
          Authorization: `Bearer ${activePageAccessToken}`,
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
      `${graphRoot}/${graphVersion}/${encodeURIComponent(activePageId)}${endpoint ? `/${endpoint}` : ''}`,
    );
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
    return rawRequest(url, fetchOptions, requestTimeoutMs);
  }

  async function nodeRequest(nodeId, options = {}) {
    const { query, timeoutMs: requestTimeoutMs, ...fetchOptions } = options;
    const url = new URL(
      `${graphRoot}/${graphVersion}/${String(nodeId).split('/').filter(Boolean).map(encodeURIComponent).join('/')}`,
    );
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
    return rawRequest(url, fetchOptions, requestTimeoutMs);
  }

  async function recoverPageSession() {
    if (recoveredSession) return null;
    recoveredSession = true;
    let pages = [];
    try {
      const accounts = await nodeRequest('me/accounts', {
        method: 'GET',
        query: { fields: 'id,name,access_token', limit: '100' },
      });
      pages = Array.isArray(accounts?.data) ? accounts.data : [];
    } catch {
      pages = [];
    }
    if (pages.length) {
      const match = pages.find((page) => String(page.id) === String(activePageId))
        || (pages.length === 1 ? pages[0] : null);
      if (match?.id && match.access_token) {
        activePageId = String(match.id);
        activePageAccessToken = String(match.access_token);
        return { id: activePageId, name: match.name || '' };
      }
      const names = pages.map((page) => `${page.name || '未命名'}（${page.id}）`).join('、');
      throw new FacebookPublishError(
        `設定的 Facebook ID 不是可發文的粉專。請改用 me/accounts 裡的粉專 ID 與 access_token。可用粉專：${names}`,
      );
    }
    return null;
  }

  async function inspectTokenIdentity() {
    return nodeRequest('me', { method: 'GET', query: { fields: 'id,name', metadata: '1' } });
  }

  async function configuredPageReadable() {
    try {
      const payload = await graphRequest('', { method: 'GET', query: { fields: 'id,name', metadata: '1' } });
      return payload?.metadata?.type === 'page' && String(payload.id) === String(activePageId);
    } catch {
      return false;
    }
  }

  async function refineObjectAccessError(error) {
    if (await configuredPageReadable()) {
      return new FacebookPublishError(FACEBOOK_PAGE_OPERATION_MESSAGE, {
        code: error.code,
        subcode: error.subcode,
        status: error.status,
        traceId: error.traceId,
        retriable: error.retriable,
      });
    }
    return error;
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
        Authorization: `OAuth ${activePageAccessToken}`,
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
      const form = await mediaFormForPath(videoPaths[0], 'description', message, options.mediaBuffers);
      applyScheduleParams(form, scheduleParams);
      const payload = await graphRequest('videos', { body: form, timeoutMs: uploadTimeoutMs });
      return { externalId: payload.id, videoId: payload.id, type: 'video' };
    }

    if (filePaths.length === 1) {
      const form = await mediaFormForPath(filePaths[0], 'caption', message, options.mediaBuffers);
      applyScheduleParams(form, scheduleParams);
      const payload = await graphRequest('photos', { body: form });
      return { externalId: payload.post_id || payload.id, photoId: payload.id, type: 'photo' };
    }

    if (filePaths.length > 1) {
      const photoUploadPromises = filePaths.map(async (filePath) => {
        const form = await mediaFormForPath(filePath, '', '', options.mediaBuffers);
        form.append('published', 'false');
        if (scheduleParams) form.append('temporary', 'true');
        const uploaded = await graphRequest('photos', { body: form });
        if (!uploaded.id) throw new FacebookPublishError('Facebook 未回傳照片 ID，無法建立多圖貼文。');
        return uploaded.id;
      });
      const photoIds = await Promise.all(photoUploadPromises);
      const body = new URLSearchParams({ message });
      applyScheduleParams(body, scheduleParams);
      photoIds.forEach((photoId, index) => body.append(`attached_media[${index}]`, JSON.stringify({ media_fbid: photoId })));
      const payload = await graphRequest('feed', {
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      return { externalId: payload.id, photoIds, type: 'multi-photo' };
    }

    const body = new URLSearchParams({ message });
    applyScheduleParams(body, scheduleParams);
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
    const uploaded = await uploadVideoBuffer(uploadUrl, videos[0], options.mediaBuffers, {
      rawRequest,
      pageAccessToken: activePageAccessToken,
      uploadTimeoutMs,
    });
    if (!uploaded) await uploadVideoBinary(uploadUrl, videos[0]);
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

  async function publishPhotoStory(filePath, mediaBuffers = []) {
    const form = await mediaFormForPath(filePath, '', '', mediaBuffers);
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

  async function publishVideoStory(filePath, mediaBuffers = []) {
    const { videoId, uploadUrl } = await startResumableVideo('video_stories');
    const uploaded = await uploadVideoBuffer(uploadUrl, filePath, mediaBuffers, {
      rawRequest,
      pageAccessToken: activePageAccessToken,
      uploadTimeoutMs,
    });
    if (!uploaded) await uploadVideoBinary(uploadUrl, filePath);
    const finished = await finishResumableVideo('video_stories', videoId);
    return {
      externalId: finished.post_id || videoId,
      videoId,
      postId: finished.post_id || null,
      type: 'video-story',
    };
  }

  async function publishStory(filePaths, options = {}) {
    const { videos, images } = splitMedia(filePaths);
    if (filePaths.length !== 1 || (videos.length + images.length) !== 1) {
      throw new FacebookPublishError('Facebook 限時動態一次只能發一張圖片或一支影片。');
    }
    if (videos.length === 1) return publishVideoStory(videos[0], options.mediaBuffers);
    return publishPhotoStory(images[0], options.mediaBuffers);
  }

  async function publishOnce(post, options = {}) {
    const contentType = String(options.contentType || post.contentType || 'post').trim() || 'post';
    const filePaths = collectMediaPathsWithBuffers(options);

    if (options.scheduledAt && contentType === 'story') {
      throw new FacebookPublishError('Facebook 限時動態不支援排程，請改用立刻發布。');
    }

    let result;
    if (contentType === 'reel') result = await publishReel(post, filePaths, options);
    else if (contentType === 'story') result = await publishStory(filePaths, options);
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

  async function publish(post, options = {}) {
    try {
      return await publishOnce(post, options);
    } catch (error) {
      if (!(error instanceof FacebookPublishError) || !isFacebookObjectAccessError(error)) throw error;
      const recovered = await recoverPageSession();
      if (recovered) return publishOnce(post, options);
      throw await refineObjectAccessError(error);
    }
  }

  async function deleteScheduled(externalId) {
    const id = String(externalId || '').trim();
    if (!id) throw new FacebookPublishError('缺少要取消的 Facebook 排程 ID。');
    await rawRequest(`${graphRoot}/${graphVersion}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { deleted: true, externalId: id };
  }

  async function verifyOnce() {
    let me = null;
    try {
      me = await inspectTokenIdentity();
    } catch (error) {
      if (!(error instanceof FacebookPublishError) || !isFacebookObjectAccessError(error)) throw error;
    }
    if (me?.metadata?.type === 'user') {
      throw new FacebookPublishError(FACEBOOK_USER_TOKEN_MESSAGE);
    }
    if (me?.metadata?.type === 'page' && me.id && String(me.id) !== String(activePageId)) {
      throw new FacebookPublishError(
        `這個 Token 屬於粉專「${me.name || ''}」（${me.id}），與設定的 ID ${activePageId} 不一致。請用同一筆 me/accounts 的 id 與 access_token。`,
      );
    }

    const payload = await graphRequest('', { method: 'GET', query: { fields: 'id,name', metadata: '1' } });
    if (payload?.metadata?.type === 'user') {
      const recovered = await recoverPageSession();
      if (recovered) return recovered;
      throw new FacebookPublishError(FACEBOOK_OBJECT_ACCESS_MESSAGE);
    }
    return { id: payload.id, name: payload.name || '' };
  }

  async function verify() {
    try {
      return await verifyOnce();
    } catch (error) {
      if (!(error instanceof FacebookPublishError) || !isFacebookObjectAccessError(error)) throw error;
      const recovered = await recoverPageSession();
      if (!recovered) throw error;
      return verifyOnce();
    }
  }

  return { configured, publish, verify, deleteScheduled };
}
